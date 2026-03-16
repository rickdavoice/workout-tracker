// --- Firebase Setup ---
const db = firebase.firestore();

// --- Variables ---
let currentWorkoutId = null;
let currentIndex = 0;
let currentDate = getLocalISODate();
let rest = 90;
let interval;

const exercises = {};   // exerciseID -> {name}
const workouts = {};    // workoutID -> {name, exercises: [exerciseID]}
const logCache = {};    // date -> workoutID -> [sets]

// --- Utility ---
function getLocalISODate(d = new Date()) {
  const tzo = d.getTimezoneOffset();
  return new Date(d.getTime() - tzo*60*1000).toISOString().slice(0,10);
}

// --- Timer ---
function updateTimerDisplay(){ document.getElementById("timer").innerText = rest; }
function startTimer(){ 
  clearInterval(interval); 
  rest=90; 
  updateTimerDisplay(); 
  interval = setInterval(() => {
      rest--; 
      updateTimerDisplay(); 
      if(rest <= 0){ 
          clearInterval(interval); 
          alert("Rest done 💪"); 
      }
  }, 1000); 
}

// --- Input adjustments ---
function changeValue(id, amount){ 
  let el = document.getElementById(id); 
  let newValue = parseFloat(el.value||0) + amount; 
  if(newValue < 0) newValue = 0; 
  el.value = newValue; 
}

// --- Calendar ---
function generateCalendar(){
  const cal=document.getElementById("calendar");
  cal.innerHTML="";
  const today=new Date();
  for(let i=-7;i<7;i++){
    const d=new Date(); d.setDate(today.getDate()+i);
    const iso=getLocalISODate(d);
    const dayDiv=document.createElement("div");
    dayDiv.className="day";
    if(iso===currentDate) dayDiv.classList.add("today");
    const completed = logCache[iso]?.[currentWorkoutId]?.length;
    if(completed) dayDiv.classList.add("completed");
    dayDiv.innerHTML=`${d.toLocaleDateString('en-US',{weekday:'short'}).charAt(0)}<br>${d.getDate()}`;
    dayDiv.onclick=()=>{ currentDate=iso; loadExercise(); generateCalendar(); };
    cal.appendChild(dayDiv);
  }
  const todayEl=document.querySelector(".day.today");
  if(todayEl) todayEl.scrollIntoView({behavior:"smooth", inline:"center"});
}

// --- Load sets for an exercise ---
function getSets(exId){
  const sets = logCache[currentDate]?.[currentWorkoutId] || [];
  const filtered = sets.filter(s => s.exerciseId === exId).slice(-5);
  return filtered.map((s,i)=>{
      const noteIcon = s.notes
          ? `<span style="cursor:pointer" onclick="alert('Note: ${s.notes.replace(/'/g,"\\'")}')">📝</span>`
          : `<span style="width:24px;display:inline-block"></span>`;
      const deleteIcon = `<span style="cursor:pointer;color:red;" onclick="deleteSet('${s.id}')" title="Delete set">❌</span>`;
      return `<div style="display:flex;gap:10px;align-items:center">
                  <span style="flex:1">${i+1}</span>
                  <span style="flex:2">${s.weight} lbs</span>
                  <span style="flex:2">${s.reps} reps</span>
                  <span style="flex:0">${noteIcon}</span>
                  <span style="flex:0">${deleteIcon}</span>
              </div>`;
  }).join("");
}

// --- Delete set ---
async function deleteSet(setID){
  if(!confirm("Delete this set?")) return;
  try {
    await db.collection("workout-logs").doc(setID).delete();
    // update local cache
    for(let date in logCache){
      if(logCache[date][currentWorkoutId]){
        logCache[date][currentWorkoutId] = logCache[date][currentWorkoutId].filter(s=>s.id!==setID);
      }
    }
    loadExercise();
    generateCalendar();
  } catch(e){
    console.error(e);
    alert("Delete failed");
  }
}

// --- Load data from Firestore ---
async function loadData(){
  try{
    // --- Load exercises ---
    const exSnap = await db.collection("exercises").get();
    exSnap.forEach(doc => exercises[doc.id] = {name: doc.data().name});

    // --- Load workouts ---
    const wSnap = await db.collection("workouts").get();
    wSnap.forEach(doc => workouts[doc.id] = {name: doc.data().name, exercises: []});

    // --- Load workout-exercises in order ---
    const weSnap = await db.collection("workout-exercises").orderBy("order").get();
    weSnap.forEach(doc=>{
      const { workoutID, exerciseID } = doc.data();
      if(workouts[workoutID]) workouts[workoutID].exercises.push(exerciseID);
    });

    // --- Load workout-logs ---
    const logSnap = await db.collection("workout-logs").get();
    logSnap.forEach(doc=>{
      const data = doc.data();
      if(!logCache[data.date]) logCache[data.date] = {};
      if(!logCache[data.date][data.workoutID]) logCache[data.date][data.workoutID] = [];
      logCache[data.date][data.workoutID].push({
        id: doc.id,
        exerciseId: data.exerciseID,
        weight: data.weight,
        reps: data.reps,
        notes: data.notes || ""
      });
    });

    // --- Set default workout ---
    currentWorkoutId = Object.keys(workouts)[0] || null;

    loadExercise();
    generateCalendar();
    updateTabs(currentWorkoutId);

  } catch(e){ console.error(e); alert("Failed to load data"); }
}

// --- Load exercise card ---
function loadExercise(){
  if(!currentWorkoutId) return;
  const container = document.getElementById("exerciseCard");
  const exId = workouts[currentWorkoutId].exercises[currentIndex];
  if(!exId) {
    container.innerHTML = "<p>No exercises for this workout.</p>";
    return;
  }

  const weightVal = document.getElementById("weight")?.value || "";
  const repsVal = document.getElementById("reps")?.value || "";
  const notesVal = document.getElementById("notes")?.value || "";

  container.innerHTML = `<div class="card">
      <div class="exercise">${exercises[exId].name}</div>
      <div class="input-group">
          <button onclick="changeValue('weight',-2.5)">-</button>
          <input id="weight" placeholder="Weight (lbs)" type="number" value="${weightVal}">
          <button onclick="changeValue('weight',2.5)">+</button>
      </div>
      <div class="input-group">
          <button onclick="changeValue('reps',-1)">-</button>
          <input id="reps" placeholder="Reps" type="number" value="${repsVal}">
          <button onclick="changeValue('reps',1)">+</button>
      </div>
      <div class="input-group">
          <input id="notes" placeholder="Notes (optional)" value="${notesVal}">
      </div>
      <button class="full-width save" onclick="saveSet()">Save</button>
      <div class="sets">${getSets(exId)}</div>
  </div>`;
}

// --- Save set ---
async function saveSet(){
  if(!currentWorkoutId) return;
  const exId = workouts[currentWorkoutId].exercises[currentIndex];
  const weight = parseFloat(document.getElementById("weight").value);
  const reps = parseInt(document.getElementById("reps").value);
  const notes = document.getElementById("notes")?.value || "";
  if(!weight||!reps){ alert("Please enter weight and reps"); return; }

  try{
    const docRef = await db.collection("workout-logs").add({
      date: currentDate,
      workoutID: currentWorkoutId,
      exerciseID: exId,
      weight,
      reps,
      notes
    });

    // update local cache
    if(!logCache[currentDate]) logCache[currentDate] = {};
    if(!logCache[currentDate][currentWorkoutId]) logCache[currentDate][currentWorkoutId] = [];
    logCache[currentDate][currentWorkoutId].push({
      id: docRef.id,
      exerciseId: exId,
      weight,
      reps,
      notes
    });

    startTimer();
    loadExercise();
    generateCalendar();
  } catch(e){ console.error(e); alert("Failed to save set."); }
}

// --- Next exercise ---
function nextExercise(){
  if(!currentWorkoutId) return;
  if(currentIndex < workouts[currentWorkoutId].exercises.length - 1){
    currentIndex++;
  } else {
    alert("Workout Complete! 🎉");
    currentIndex = 0;
  }
  loadExercise();
}

// --- Tabs ---
function updateTabs(workoutId){
  document.querySelectorAll('.tabs button').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.workout === workoutId);
  });
}
function loadWorkout(workoutId){
  currentWorkoutId = workoutId;
  currentIndex = 0;
  updateTabs(workoutId);
  loadExercise();
  generateCalendar();
}

// --- Swipe navigation ---
let touchStartX=0;
const cardContainer=document.getElementById("exerciseCard");
if(cardContainer){
  cardContainer.addEventListener('touchstart', e=>{ touchStartX=e.changedTouches[0].clientX; });
  cardContainer.addEventListener('touchend', e=>{
    const delta=e.changedTouches[0].clientX - touchStartX;
    if(Math.abs(delta) > 50){
      delta < 0 ? nextExercise() : currentIndex>0 && currentIndex--;
      loadExercise();
    }
  });
}

// --- Initial load ---
loadData();
updateTimerDisplay();
generateCalendar();
