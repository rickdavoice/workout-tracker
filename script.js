// --- Firebase App (already initialized in HTML) ---
const db = firebase.firestore();

// --- Variables ---
let currentWorkoutId = null;
// --- Input state ---
let inputState = {
  weight: '',
  reps: '',
  notes: '',
  lastExId: null
};
let currentIndex = 0;
let currentDate = getLocalISODate();
let rest = 90;
let interval;
let workouts = {};          // { workoutId: {name, exercises: [exerciseId,...]} }
let exercises = {};         // { exerciseId: exerciseName }
let logCache = {};          // { date: { workoutId: [sets] } }

// --- Utility ---
function getLocalISODate(d = new Date()){
  const tzo = d.getTimezoneOffset();
  return new Date(d.getTime() - tzo*60*1000).toISOString().slice(0,10);
}

// --- Timer ---
function updateTimerDisplay(){ document.getElementById("timer").innerText = rest; }
function startTimer(){
  clearInterval(interval);
  rest = 90; updateTimerDisplay();
  interval = setInterval(()=>{
    rest--;
    updateTimerDisplay();
    if(rest<=0){
      clearInterval(interval);
      // Play sound
      setTimeout(() => {
        let audio = new Audio("https://www.soundjay.com/button/beep-07.wav");
        audio.play().catch(()=>{
          // fallback: try another sound
          let fallback = new Audio("https://www.soundjay.com/button/beep-09.wav");
          fallback.play();
        });
      }, 100);
    }
  },1000);
}

// --- Input adjustments ---
function changeValue(id, amount){
  const el = document.getElementById(id);
  if(!el) return;
  let newValue = parseFloat(el.value||0) + amount;
  if(newValue<0) newValue = 0;
  el.value = newValue;
}

// --- Calendar ---
function generateCalendar(){
  const cal = document.getElementById("calendar");
  cal.innerHTML = "";
  const today = new Date();
  for(let i=-7; i<7; i++){
    const d = new Date(); d.setDate(today.getDate()+i);
    const iso = getLocalISODate(d);
    const dayDiv = document.createElement("div");
    dayDiv.className="day";
    if(iso===currentDate) dayDiv.classList.add("today");
    const completed = logCache[iso]?.[currentWorkoutId]?.length;
    if(completed) dayDiv.classList.add("completed");
    dayDiv.innerHTML = `${d.toLocaleDateString('en-US',{weekday:'short'}).charAt(0)}<br>${d.getDate()}`;
    dayDiv.onclick = ()=>{ currentDate=iso; loadExercise(); generateCalendar(); };
    cal.appendChild(dayDiv);
  }
  const todayEl = document.querySelector(".day.today");
  if(todayEl){ todayEl.scrollIntoView({behavior:"smooth", inline:"center"}); }
}

// --- Load data ---
async function loadData(){
  try{
    // --- Exercises ---
    const exSnap = await db.collection("exercises").get();
    exercises = {};
    exSnap.forEach(doc=>{ exercises[doc.id] = doc.data().name; });

    // --- Workouts ---
    const workoutSnap = await db.collection("workouts").get();
    workouts = {};
    workoutSnap.forEach(doc=>{
      workouts[doc.id] = { name: doc.data().name, exercises: [] };
    });

    // --- Workout-Exercises mapping ---
    const wxSnap = await db.collection("workout-exercises").orderBy("order").get();
    wxSnap.forEach(doc=>{
      const data = doc.data();
      if(workouts[data.workoutID]){
        workouts[data.workoutID].exercises.push(data.exerciseID);
      }
    });

    // --- Workout logs ---
    const logSnap = await db.collection("workout-logs").get();
    logCache = {};
    logSnap.forEach(doc=>{
      const set = doc.data();
      const date = set.date;
      const workoutId = set.workoutID;
      if(!logCache[date]) logCache[date]={};
      if(!logCache[date][workoutId]) logCache[date][workoutId]=[];
      logCache[date][workoutId].push({...set, id: doc.id});
    });

    setupTabs();
    if(Object.keys(workouts).length>0){
      currentWorkoutId = Object.keys(workouts)[0];
      loadWorkout(currentWorkoutId);
    }
    generateCalendar();
  }catch(e){ console.error(e); alert("Failed to load data"); }
}

// --- Setup workout buttons dynamically ---
function setupTabs(){
  const tabContainer = document.querySelector(".tabs");
  tabContainer.innerHTML = "";
  Object.keys(workouts).forEach((id, idx)=>{
    const btn = document.createElement("button");
    btn.textContent = workouts[id].name || `Workout ${String.fromCharCode(65+idx)}`;
    btn.dataset.workout = id;
    btn.onclick = ()=> loadWorkout(id);
    tabContainer.appendChild(btn);
  });
  updateTabs(currentWorkoutId);
}
function updateTabs(id){
  document.querySelectorAll(".tabs button").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.workout===id);
  });
}

// --- Load exercise card ---
function loadExercise(){
  if(!currentWorkoutId || !workouts[currentWorkoutId]){
    document.getElementById("exerciseCard").innerHTML = "<p>No workout selected.</p>";
    return;
  }
  const container = document.getElementById("exerciseCard");
  const exId = workouts[currentWorkoutId].exercises[currentIndex];
  if(!exId){
    container.innerHTML = "<p>No exercises for this workout.</p>";
    inputState = { weight: '', reps: '', notes: '', lastExId: null };
    return;
  }
  const exName = exercises[exId] || "Exercise";
  const setsHTML = getSets(exId);

  // If exercise changed, clear inputState
  if (inputState.lastExId !== exId) {
    inputState = { weight: '', reps: '', notes: '', lastExId: exId };
  } else {
    inputState.lastExId = exId;
  }

  // --- Swipe animation ---
  // Card swipe animation logic
  function animateCardSwipe(direction) {
    const card = document.getElementById("exerciseCard");
    if (!card) return;
    const outOffset = direction === "right" ? -100 : 100;
    const inOffset = direction === "right" ? 100 : -100;

    // Faster slide out
    card.style.transition = "transform 0.12s ease-in-out";
    card.style.transform = `translateX(${outOffset}%)`;

    setTimeout(() => {
      if (direction === "right") {
        currentIndex = Math.min(currentIndex + 1, workouts[currentWorkoutId].exercises.length - 1);
      } else {
        currentIndex = Math.max(currentIndex - 1, 0);
      }
      container.innerHTML = "";
      loadExercise();
      const newCard = document.getElementById("exerciseCard");
      if (newCard) {
        newCard.style.transition = "none";
        newCard.style.transform = `translateX(${inOffset}%)`;
        setTimeout(() => {
          newCard.style.transition = "transform 0.12s ease-in-out";
          newCard.style.transform = "translateX(0)";
        }, 20);
      }
    }, 120);
  }

  // Attach swipe listeners only once
  if (!window._swipeListenerAttached) {
    window._swipeListenerAttached = true;
    const cardContainer = document.getElementById("exerciseCardContainer");
    let touchStartX = 0;
    if (cardContainer) {
      cardContainer.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].clientX;
      });
      cardContainer.addEventListener('touchend', e => {
        const delta = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(delta) > 50) {
          if (delta < 0 && currentIndex < workouts[currentWorkoutId].exercises.length - 1) {
            animateCardSwipe("right"); // swipe left, go to next
          } else if (delta > 0 && currentIndex > 0) {
            animateCardSwipe("left"); // swipe right, go to prev
          }
        }
      });
    }
  }

  container.innerHTML = `
    <div class="card">
      <div class="exercise">${exName}</div>
      <div class="input-group">
        <button onclick="changeValue('weight',-2.5)">-</button>
        <input id="weight" placeholder="Weight (lbs)" type="number" value="${inputState.weight}">
        <button onclick="changeValue('weight',2.5)">+</button>
      </div>
      <div class="input-group">
        <button onclick="changeValue('reps',-1)">-</button>
        <input id="reps" placeholder="Reps" type="number" value="${inputState.reps}">
        <button onclick="changeValue('reps',1)">+</button>
      </div>
      <div class="input-group">
        <input id="notes" placeholder="Notes (optional)" value="${inputState.notes}">
      </div>
      <button class="full-width save" onclick="saveSet()">Save</button>
      <div class="sets">${setsHTML}</div>
    </div>
  `;
}

// --- Get sets ---
function getSets(exId){
  const sets = logCache[currentDate]?.[currentWorkoutId] || [];
  // Order sets by reps ascending (lowest reps at top, highest at bottom)
  const filtered = sets.filter(s=>s.exerciseID===exId)
    .sort((a,b)=>parseInt(a.reps)-parseInt(b.reps))
    .slice(-5); // show last 5 sets

  if(filtered.length === 0) return `<div class="sets-list-empty">No sets yet</div>`;
  return filtered.map((s,i)=>{
    return `<div class="sets-list-item">
      <div class="sets-list-main">
        <span class="sets-list-weight">${s.weight} <span class="sets-list-unit">lbs</span></span>
        <span class="sets-list-reps">${s.reps} <span class="sets-list-unit">reps</span></span>
        <span class="sets-list-del" onclick="deleteSet('${s.id}')">❌</span>
      </div>
      ${s.notes ? `<div class="sets-list-note-row"><span class="sets-list-note" title="${s.notes}" onclick="alert('Note: ${s.notes.replace(/'/g,"\\'")}')">📝 ${s.notes}</span></div>` : ""}
    </div>`;
  }).join("");
}

// --- Save set ---
async function saveSet(){
  const exId = workouts[currentWorkoutId].exercises[currentIndex];
  if(!exId) return;
  const weight = document.getElementById("weight").value;
  const reps = document.getElementById("reps").value;
  const notes = document.getElementById("notes").value || "";
  inputState = { weight, reps, notes, lastExId: workouts[currentWorkoutId].exercises[currentIndex] };
  if(!weight||!reps){ alert("Enter weight & reps"); return; }

  try{
    const docRef = await db.collection("workout-logs").add({
      date: currentDate,
      workoutID: currentWorkoutId,
      exerciseID: exId,
      weight, reps, notes
    });
    if(!logCache[currentDate]) logCache[currentDate]={};
    if(!logCache[currentDate][currentWorkoutId]) logCache[currentDate][currentWorkoutId]=[];
    logCache[currentDate][currentWorkoutId].push({id: docRef.id, exerciseID: exId, weight, reps, notes});
    startTimer();
    loadExercise();
    generateCalendar();
  }catch(e){ console.error(e); alert("Failed to save set"); }
}

// --- Delete set ---
async function deleteSet(setId){
  if(!confirm("Delete this set?")) return;
  try{
    await db.collection("workout-logs").doc(setId).delete();
    for(let date in logCache){
      if(logCache[date][currentWorkoutId]){
        logCache[date][currentWorkoutId] = logCache[date][currentWorkoutId].filter(s=>s.id!==setId);
      }
    }
    loadExercise();
    generateCalendar();
  }catch(e){ console.error(e); alert("Delete failed"); }
}

// --- Next exercise ---
function nextExercise(){
  if(!workouts[currentWorkoutId]) return;
  if(currentIndex<workouts[currentWorkoutId].exercises.length-1){
    currentIndex++;
    loadExercise();
  } else {
    alert("Workout Complete! 🎉");
    currentIndex = 0;
    loadExercise();
  }
}

// --- Load workout ---
function loadWorkout(workoutId){
  currentWorkoutId = workoutId;
  currentIndex = 0;
  updateTabs(workoutId);
  loadExercise();
  generateCalendar();
}

// ...existing code...

// --- Initial load ---
loadData();
updateTimerDisplay();
generateCalendar();
