const API_URL = "https://script.google.com/macros/s/AKfycbz2rdiHrOctB3ARidoNZWjRZpNixS7n0WvJj2ugp8TaxUnPemFB9m3awCKg0lpn9oT_/exec"; // replace with your Apps Script URL

// --- Variables ---
let currentWorkout = "A";
let currentIndex = 0;
let navigationDirection = "next";
let currentDate = getLocalISODate();
let rest = 90;
let interval;
let exercisesMap = {};
let workoutsMap = {};
let logCache = {};
let exerciseNameToID = {};
const workouts = { A: [], B: [] };

// --- Utility ---
function getLocalISODate(d = new Date()){ const tzo=d.getTimezoneOffset(); return new Date(d.getTime()-tzo*60*1000).toISOString().slice(0,10); }

// --- Timer ---
function updateTimerDisplay(){ document.getElementById("timer").innerText = rest; }
function startTimer(){ clearInterval(interval); rest=90; updateTimerDisplay(); interval=setInterval(()=>{ rest--; updateTimerDisplay(); if(rest<=0){ clearInterval(interval); alert("Rest done 💪"); } },1000); }

// --- Input adjustments ---
function changeValue(id, amount){ let el=document.getElementById(id); let newValue=parseFloat(el.value||0)+amount; if(newValue<0)newValue=0; el.value=newValue; }

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
        const completed = logCache[iso]?.[currentWorkout]?.length;
        if(completed) dayDiv.classList.add("completed");
        dayDiv.innerHTML=`${d.toLocaleDateString('en-US',{weekday:'short'}).charAt(0)}<br>${d.getDate()}`;
        dayDiv.onclick=()=>{ currentDate=iso; loadExercise(); generateCalendar(); };
        cal.appendChild(dayDiv);
    }
    const todayEl=document.querySelector(".day.today");
    if(todayEl){ todayEl.scrollIntoView({behavior:"smooth", inline:"center"}); }
}

// --- Load data ---
// --- getSets() ---
function getSets(ex){
  const sets = logCache[currentDate]?.[currentWorkout] || [];
  const filtered = sets.filter(s => s.exercise === ex).slice(-5);
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

// --- deleteSet() ---
async function deleteSet(setID, row) {

  if(!confirm("Delete this set?")) return;

  try {

    const res = await fetch(API_URL,{
      method:"POST",
      body: JSON.stringify({
        type:"delete",
        id:setID,
        row:row
      })
    });

    const result = await res.json();

    if(result.status==="deleted"){

      for(let date in logCache){
        for(let workout in logCache[date]){
          logCache[date][workout] =
            logCache[date][workout].filter(s=>s.id!==setID);
        }
      }

      loadExercise();
      generateCalendar();
    }

  } catch(e){
    console.error(e);
    alert("Delete failed");
  }
}

// --- loadData() ---
async function loadData() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();

    exercisesMap = {};
exerciseNameToID = {};

data.exercises.forEach(r=>{
  exercisesMap[r[0]] = r[1];
  exerciseNameToID[r[1]] = r[0];
});

    workoutsMap = {};
    data.workouts.forEach(r=>{
      const w=r[0], exID=r[2];
      if(!workoutsMap[w]) workoutsMap[w]=[];
      workoutsMap[w].push(exID);
    });

    // build workouts array
    for(let w in workoutsMap){
      workouts[w] = workoutsMap[w].map(id=>exercisesMap[id]).filter(n=>n!==undefined);
    }

    // load sets
    logCache = {};
    data.sets.forEach(set=>{
      const exName = set.exercise || exercisesMap[set.exerciseID];
      if(!exName) return;
      const date = set.date;
      const workout = set.workout || "A";
      if(!logCache[date]) logCache[date]={};
      if(!logCache[date][workout]) logCache[date][workout]=[];
      logCache[date][workout].push({
        id: set.id,
        exercise: exName,
        weight: set.weight,
        reps: set.reps,
        notes: set.notes||""
      });
    });

    loadExercise();
    generateCalendar();
  } catch(e){ console.error(e); alert("Failed to load data"); }
}

// --- Load exercise card ---
function loadExercise(){
    const container=document.getElementById("exerciseCard");
    const ex=workouts[currentWorkout][currentIndex];
    const weightVal=document.getElementById("weight")?.value||"";
    const repsVal=document.getElementById("reps")?.value||"";
    const notesVal=document.getElementById("notes")?.value||"";
    container.innerHTML=`<div class="card">
        <div class="exercise">${ex}</div>
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
        <div class="sets">${getSets(ex)}</div>
    </div>`;
}

// --- Save set ---
async function saveSet(){
    const ex = workouts[currentWorkout][currentIndex];
    const weight = document.getElementById("weight").value;
    const reps = document.getElementById("reps").value;
    const notes = document.getElementById("notes")?.value||"";
    if(!weight||!reps){ alert("Please enter weight and reps"); return; }

    const exID = exerciseNameToID[ex];
    const payload = {exerciseID: exID, exercise: ex, weight, reps, notes};

    try{
        const res = await fetch(API_URL,{method:"POST",body:JSON.stringify(payload)});
        const result = await res.json();
        if(!logCache[currentDate]) logCache[currentDate]={};
        if(!logCache[currentDate][currentWorkout]) logCache[currentDate][currentWorkout]=[];
        logCache[currentDate][currentWorkout].push({
  id: result.id,
  row: result.row,
  exercise: ex,
  weight,
  reps,
  notes
});
        startTimer(); loadExercise(); generateCalendar();
    } catch(e){ console.error("Error saving set",e); alert("Failed to save set. Check internet connection."); }
}

// --- Next exercise ---
function nextExercise(){ navigationDirection="next"; if(currentIndex<workouts[currentWorkout].length-1){ currentIndex++; loadExercise(); } else { alert("Workout Complete! 🎉"); currentIndex=0; loadExercise(); } }

// --- Tab buttons ---
function updateTabs(type){ document.querySelectorAll('.tabs button').forEach(btn=>{ btn.classList.toggle('active',btn.dataset.workout===type); }); }
function loadWorkout(type){ currentWorkout=type; currentIndex=0; updateTabs(type); loadExercise(); generateCalendar(); }

// --- Swipe ---
let touchStartX=0;
const cardContainer=document.getElementById("exerciseCard");
if(cardContainer){
    cardContainer.addEventListener('touchstart', e=>{ touchStartX=e.changedTouches[0].clientX; });
    cardContainer.addEventListener('touchend', e=>{
        const delta=e.changedTouches[0].clientX-touchStartX;
        if(Math.abs(delta)>50){ navigationDirection=delta<0?"next":"prev"; delta<0?nextExercise():currentIndex>0&&currentIndex--; loadExercise(); }
    });
}

// --- Initial load ---
loadData();
updateTabs(currentWorkout);
updateTimerDisplay();
generateCalendar();