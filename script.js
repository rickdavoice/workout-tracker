// --- Firebase App (already initialized in HTML) ---
const db = firebase.firestore();

// --- Variables ---
let editingSetId = null;
let lastLoadedDate = null;
let currentWorkoutId = null;
let activeTab = 'track';
let historySets = [];
let isLoadingHistory = false;
let calendarDate = new Date(); // controls what month is shown
// --- Input state & per-day memory ---
let inputState = { weight:'', reps:'', notes:'', lastExId: null };
let lastInputByDate = {}; // { [date]: { [exerciseId]: { weight, reps } } }
let currentIndex = 0;
let currentDate = getLocalISODate();
let rest = 75;
let interval;
let workouts = {};          // { workoutId: {name, exercises: [exerciseId,...]} }
let exercises = {};         // { exerciseId: exerciseName }
let logCache = {};          // { date: { workoutId: [sets] } }

const workoutColors = {};
const colorPalette = [
  "#6c3483", // purple
  "#2ecc71", // green
  "#3498db", // blue
  "#e67e22", // orange
  "#e74c3c", // red
  "#f1c40f"  // yellow
];

// --- Utility ---
function getLocalISODate(d = new Date()){
  const tzo = d.getTimezoneOffset();
  return new Date(d.getTime() - tzo*60*1000).toISOString().slice(0,10);
}


// --- Input adjustments ---
function changeValue(id, amount){
  const el = document.getElementById(id);
  if(!el) return;
  let newValue = parseFloat(el.value||0) + amount;
  if(newValue<0) newValue = 0;
  el.value = newValue;
}

async function switchTab(tab) {
  activeTab = tab;

  if (tab === 'history') {
    await loadHistory();
  } else {
    historySets = []; // reset when going back to track
  }

  loadExercise();
}

async function loadHistory() {
  try {
    const exId = workouts[currentWorkoutId]?.exercises[currentIndex];
    if (!exId) return;

    isLoadingHistory = true;
    historySets = [];
    loadExercise(); // show loading state

    const snapshot = await db.collection("workout-logs")
      .where("exerciseID", "==", exId)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    historySets = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

  } catch (e) {
    console.error("Failed to load history:", e);
    historySets = [];
  } finally {
    isLoadingHistory = false;
    loadExercise(); // re-render after data loads
  }
}

function historyHTML() {
  if (isLoadingHistory) {
    return `<div style="opacity:0.6;">Loading...</div>`;
  }

  if (!historySets.length) {
    return `<div style="opacity:0.6;">No history yet</div>`;
  }

  // --- Group by date ---
  const grouped = {};

  historySets.forEach(set => {
    const date = set.date;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(set);
  });

  // --- Sort dates (newest first) ---
  const sortedDates = Object.keys(grouped).sort((a,b) => b.localeCompare(a));

  // --- Build UI ---
  return sortedDates.map(date => {
    const sets = grouped[date].sort((a, b) => {
  const aTime = a.createdAt?.seconds
    ? a.createdAt.seconds
    : new Date(a.createdAt).getTime();

  const bTime = b.createdAt?.seconds
    ? b.createdAt.seconds
    : new Date(b.createdAt).getTime();

  return aTime - bTime; // ✅ oldest → newest
});

    const formattedDate = new Date(date + "T00:00:00").toLocaleDateString('default', {
      month: 'long',
      day: 'numeric'
    });

    return `
      <div class="history-day">
        <div class="history-date">${formattedDate}</div>

        ${sets.map(s => `
          <div class="history-row">
            <span>${s.weight} lbs</span>
            <span>${s.reps} reps</span>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}


// --- Load data ---
async function loadData() {
  try {
    // --- Exercises ---
    try {
      const exSnap = await db.collection("exercises").get();
      exercises = {};
      exSnap.forEach(doc => {
        exercises[doc.id] = doc.data().name;
      });
    } catch (e) {
      console.error("Failed to load exercises:", e);
      exercises = {};
    }

    // --- Workouts ---
    try {
      const workoutSnap = await db.collection("workouts").get();
      workouts = {};
      workoutSnap.forEach(doc => {
        workouts[doc.id] = { name: doc.data().name, exercises: [] };
      });
    } catch (e) {
      console.error("Failed to load workouts:", e);
      workouts = {};
    }

    // Assign colors to workouts
Object.keys(workouts).forEach((id, index) => {
  workoutColors[id] = colorPalette[index % colorPalette.length];
});

    // --- Workout-Exercises mapping ---
    try {
      const wxSnap = await db.collection("workout-exercises").orderBy("order").get();
      wxSnap.forEach(doc => {
        const data = doc.data();
        if (workouts[data.workoutID]) {
          workouts[data.workoutID].exercises.push(data.exerciseID);
        }
      });
    } catch (e) {
      console.error("Failed to load workout-exercises mapping:", e);
    }

    // --- Workout logs ---
    try {
      const logSnap = await db.collection("workout-logs").get();
      logCache = {};
      logSnap.forEach(doc => {
        const set = doc.data();
        const date = set.date;
        const workoutId = set.workoutID;
        if (!logCache[date]) logCache[date] = {};
        if (!logCache[date][workoutId]) logCache[date][workoutId] = [];
        logCache[date][workoutId].push({ ...set, id: doc.id });
      });
    } catch (e) {
      console.error("Failed to load workout logs:", e);
      logCache = {};
    }

    // --- Check today ---
    const todayLogs = logCache[currentDate] || {};
    const existingWorkoutIds = Object.keys(todayLogs);

    if (existingWorkoutIds.length > 0) {
      currentWorkoutId = existingWorkoutIds[0];
      loadWorkout(currentWorkoutId);
    } else {
      document.getElementById('exerciseCard').innerHTML = `<p>Select a workout for today</p>`;
      workoutModal.style.display = 'flex';
      renderWorkoutList();
    }

  } catch (e) {
    console.error("Unexpected loadData error:", e);
    alert("Failed to load data");
  }
}

function updateTodayWorkoutName() {
  const todayWorkoutEl = document.getElementById('todayWorkout');
  if (!todayWorkoutEl) return;

  if (currentWorkoutId && workouts[currentWorkoutId]) {
    todayWorkoutEl.textContent = workouts[currentWorkoutId].name;
  } else {
    todayWorkoutEl.textContent = '';
  }
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

  // Reset inputs if switching exercises (unless editing)
if (editingSetId === null && (inputState.lastExId !== exId || lastLoadedDate !== currentDate)) {
  const setsToday = logCache[currentDate]?.[currentWorkoutId] || [];

  // Last set for this exercise **today**
  const lastSetToday = [...setsToday].reverse().find(s => s.exerciseID === exId);

  const exName = (exercises[exId] || "").toLowerCase();
  const isPullUp = exName.includes("pull up");

  // Last inputs memory for this exercise today
  const lastInput = lastInputByDate[currentDate]?.[exId] || {};

  inputState = {
    weight: lastSetToday?.weight ?? lastInput.weight ?? (isPullUp ? "0" : ""),
    reps: lastSetToday?.reps ?? lastInput.reps ?? "",
    notes: "",
    lastExId: exId
  };
  lastLoadedDate = currentDate;
} else {
  inputState.lastExId = exId;
}

  const isEditing = editingSetId !== null;

  // --- Swipe animation ---
  function animateCardSwipe(direction) {
    const card = document.getElementById("exerciseCard");
    if (!card) return;

    const outOffset = direction === "right" ? -100 : 100;
    const inOffset = direction === "right" ? 100 : -100;

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
            animateCardSwipe("right");
          } else if (delta > 0 && currentIndex > 0) {
            animateCardSwipe("left");
          }
        }
      });
    }
  }

  // --- Render UI ---
  container.innerHTML = `
    <div class="card">
      <div class="exercise">${exName}</div>

      <div class="tabs">
  <button class="tab ${activeTab === 'track' ? 'active' : ''}" onclick="switchTab('track')">Track</button>
  <button class="tab ${activeTab === 'history' ? 'active' : ''}" onclick="switchTab('history')">History</button>
</div>

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

      ${isEditing ? `
        <div class="input-group">
          <input id="notes" placeholder="Notes" value="${inputState.notes}">
        </div>

        <div class="button-row">
  <button class="half-width save update" onclick="updateSet()">Update</button>
  <button class="half-width delete" onclick="deleteSet(editingSetId)">Delete</button>
</div>
        <button class="full-width cancel" onclick="cancelEdit()">Cancel</button>
      ` : `
        <button class="full-width save" onclick="saveSet()">Save</button>
      `}

      <div class="sets">
  ${activeTab === 'track' ? setsHTML : historyHTML()}
</div>
    </div>
  `;
}



// --- Get sets ---
function getSets(exId){
  const sets = logCache[currentDate]?.[currentWorkoutId] || [];
  // Order sets by reps ascending (lowest reps at top, highest at bottom)
 const filtered = sets
  .filter(s => s.exerciseID === exId)
  .sort((a,b) => {
    const aTime = a.createdAt?.seconds || new Date(a.createdAt).getTime();
    const bTime = b.createdAt?.seconds || new Date(b.createdAt).getTime();
    return aTime - bTime; // oldest → newest
  })
  .slice(-5);

  if(filtered.length === 0) return ``;
  return filtered.map((s,i)=>{
    const hasNote = s.notes && s.notes.trim() !== "";

return `<div class="sets-pill" onclick="editSet('${s.id}')">
  <div class="sets-pill-top">
    <div class="sets-pill-main">
      <span class="sets-pill-weight">${s.weight}<span class="sets-pill-unit"> lbs</span></span>
      <span class="sets-pill-reps">${s.reps}<span class="sets-pill-unit"> reps</span></span>
    </div>
    ${hasNote ? `<div class="sets-pill-note">📝</div>` : ``}
  </div>
</div>`;
  }).join("");
}


// --- Edit set --- //

function editSet(setId){
  const sets = logCache[currentDate]?.[currentWorkoutId] || [];
  const set = sets.find(s => s.id === setId);
  if(!set) return;

  editingSetId = setId;

  inputState = {
    weight: set.weight,
    reps: set.reps,
    notes: set.notes || "",
    lastExId: set.exerciseID
  };

  loadExercise();
}

// --- Update set --- //

async function updateSet(){
  if(!editingSetId) return;

  const weight = document.getElementById("weight").value;
  const reps = document.getElementById("reps").value;
  const notes = document.getElementById("notes").value || "";

  if(!weight || !reps){
    alert("Enter weight & reps");
    return;
  }

  try{
    await db.collection("workout-logs").doc(editingSetId).update({
      weight, reps, notes
    });

    // Update cache
    const sets = logCache[currentDate]?.[currentWorkoutId] || [];
    const idx = sets.findIndex(s => s.id === editingSetId);
    if(idx !== -1){
      sets[idx] = {...sets[idx], weight, reps, notes};
    }

    editingSetId = null;
    inputState = { weight: '', reps: '', notes: '', lastExId: null };

    loadExercise();
  }catch(e){
    console.error(e);
    alert("Update failed");
  }
}

// --- Save set ---
async function saveSet(){
  const exId = workouts[currentWorkoutId].exercises[currentIndex];
  if(!exId) return;

  const weight = document.getElementById("weight").value;
  const reps = document.getElementById("reps").value;

  // ✅ FIX: safely handle notes
  const notesEl = document.getElementById("notes");
  const notes = notesEl ? notesEl.value : "";

  inputState = { weight, reps, notes, lastExId: exId };

  if(!weight || !reps){
    alert("Enter weight & reps");
    return;
  }

  try{
    const docRef = await db.collection("workout-logs").add({
      date: currentDate,
      workoutID: currentWorkoutId,
      exerciseID: exId,
      weight, reps, notes, createdAt: new Date()
    });

    if(!logCache[currentDate]) logCache[currentDate]={};
    if(!logCache[currentDate][currentWorkoutId]) logCache[currentDate][currentWorkoutId]=[];

    logCache[currentDate][currentWorkoutId].push({
      id: docRef.id, exerciseID: exId, weight, reps, notes, createdAt: new Date()
    });
    // Remember the last input for this exercise today
if (!lastInputByDate[currentDate]) lastInputByDate[currentDate] = {};
lastInputByDate[currentDate][exId] = {
  weight,
  reps
};



    inputState = {
  weight,
  reps,
  notes: '', // clear notes only
  lastExId: exId
};

    loadExercise();

  }catch(e){
    console.error(e);
    alert("Failed to save set");
  }
}

// --- Delete set ---
async function deleteSet(setId){
  if(!confirm("Delete this set?")) return;

  try{
    await db.collection("workout-logs").doc(setId).delete();

    for(let date in logCache){
      if(logCache[date][currentWorkoutId]){
        logCache[date][currentWorkoutId] =
          logCache[date][currentWorkoutId].filter(s => s.id !== setId);
      }
    }

    editingSetId = null;
    inputState = { weight: '', reps: '', notes: '', lastExId: null };

    loadExercise();
  }catch(e){
    console.error(e);
    alert("Delete failed");
  }
}

// --- Cancel edit --- //

function cancelEdit(){
  editingSetId = null;
  inputState = { weight: '', reps: '', notes: '', lastExId: null };
  loadExercise();
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
  // generateCalendar();
}

// ...existing code...

// --- Initial load ---

function updateTodayDate() {
  const todayDateEl = document.getElementById('todayDate');
  if (!todayDateEl) return;

  const [year, month, day] = currentDate.split('-').map(Number);
  const d = new Date(year, month - 1, day); // LOCAL date (fixes timezone bug)

  const formatted = d.toLocaleString('default', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  todayDateEl.textContent = formatted;
}

loadData();
updateTodayDate();

function renderWorkoutList() {
  if (!workoutList) return;

  workoutList.innerHTML = "";

  Object.keys(workouts).forEach((id, idx) => {
    const btn = document.createElement("button");

    btn.textContent = workouts[id].name || `Workout ${String.fromCharCode(65+idx)}`;
    btn.className = "full-width";
    btn.style.marginBottom = "10px";

    btn.onclick = () => {
  currentWorkoutId = id;
  currentIndex = 0;

  // Make sure the day has an entry in logCache
  if (!logCache[currentDate]) logCache[currentDate] = {};
  if (!logCache[currentDate][currentWorkoutId]) logCache[currentDate][currentWorkoutId] = [];

  workoutModal.style.display = 'none';

  // Load exercises for this day/workout
  loadExercise();
  updateTodayWorkoutName();
};

    workoutList.appendChild(btn);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const calendarBtn = document.getElementById('calendarBtn');
  const calendarModal = document.getElementById('calendarModal');
  const closeCalendarModal = document.getElementById('closeCalendarModal');
  const fullCalendar = document.getElementById('fullCalendar');
  const menuDropdown = document.getElementById('menuDropdown');
  const openCalendar = document.getElementById('openCalendar');
  const openWorkouts = document.getElementById('openWorkouts');
const workoutModal = document.getElementById('workoutModal');
const closeWorkoutModal = document.getElementById('closeWorkoutModal');
const workoutList = document.getElementById('workoutList');

  if (!calendarBtn || !calendarModal || !closeCalendarModal || !fullCalendar) return;

  // 🔽 Toggle menu
  calendarBtn.onclick = (e) => {
    e.stopPropagation();
    menuDropdown.style.display =
      menuDropdown.style.display === 'block' ? 'none' : 'block';
  };

  // 📅 Open calendar from menu
  openCalendar.onclick = () => {
    menuDropdown.style.display = 'none';
    calendarModal.style.display = 'flex';
    renderFullCalendar();
  };

  // ❌ Close calendar modal
  closeCalendarModal.onclick = () => {
    calendarModal.style.display = 'none';
  };

  openWorkouts.onclick = () => {
  menuDropdown.style.display = 'none';
  calendarBtn.classList.remove('open');

  workoutModal.style.display = 'flex';
  renderWorkoutList();
};

closeWorkoutModal.onclick = () => {
  workoutModal.style.display = 'none';
};

window.changeMonth = function(offset) {
  calendarDate.setMonth(calendarDate.getMonth() + offset);
  renderFullCalendar();
};



  // 👇 Close menu if clicking outside
  document.addEventListener('click', () => {
    menuDropdown.style.display = 'none';
  });

  // ✅ FULL calendar function (real one)
  function renderFullCalendar() {
    const month = calendarDate.getMonth();
const year = calendarDate.getFullYear();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekday = firstDay.getDay();

    let html = `
  <div class="full-calendar-header">
    <button class="cal-nav" onclick="changeMonth(-1)">←</button>
    <span>${calendarDate.toLocaleString('default', { month: 'long' })} ${year}</span>
    <button class="cal-nav" onclick="changeMonth(1)">→</button>
  </div>

  <div class="calendar-body">
    <div class='full-calendar-grid'>
`;

    const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    weekdays.forEach(d => {
      html += `<div class='full-calendar-day' style='font-weight:bold; background:#181a1b;'>${d}</div>`;
    });

    for (let i = 0; i < startWeekday; i++) {
      html += `<div></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = getLocalISODate(new Date(year, month, day));
      const selected = iso === currentDate ? 'selected' : '';
      const dayLogs = logCache[iso] || {};
const workoutIds = Object.keys(dayLogs);

const dotsHTML = workoutIds.map(wId => {
  const color = workoutColors[wId] || "#888";
  return `<span class="calendar-dot" style="background:${color}"></span>`;
}).join("");

html += `
  <div class='full-calendar-day ${selected}' data-iso='${iso}'>
    <div>${day}</div>
    <div class="calendar-dots">${dotsHTML}</div>
  </div>
`;
    }

    html += `</div>`;
   
    html += `</div>`;

// 👇 ADD LEGEND HERE
html += `<div class="calendar-legend">`;

Object.keys(workouts).forEach(id => {
  html += `
    <div class="legend-item">
      <span class="legend-color" style="background:${workoutColors[id]}"></span>
      <span>${workouts[id].name}</span>
    </div>
  `;
});

html += `</div>`;
html += `</div>`;

// 👇 THEN render
fullCalendar.innerHTML = html;
   

    fullCalendar.querySelectorAll('.full-calendar-day[data-iso]').forEach(dayEl => {
  dayEl.onclick = () => {
    currentDate = dayEl.dataset.iso;
    inputState.lastExId = null;

    // Update date display
    updateTodayDate();

    // Check if a workout exists for this day
    const dayLogs = logCache[currentDate] || {};
    const existingWorkoutIds = Object.keys(dayLogs);

    if (existingWorkoutIds.length > 0) {
      // ✅ Workout exists → load it
      currentWorkoutId = existingWorkoutIds[0];
      currentIndex = 0;
      loadExercise();
      updateTodayWorkoutName();
    } else {
      // ⚡ No workout yet → open modal to select
      workoutModal.style.display = 'flex';
      renderWorkoutList(); // same as your existing modal
      document.getElementById('exerciseCard').innerHTML = `<p>Select a workout for this day</p>`;
      document.getElementById('todayWorkout').textContent = '';
    }

    calendarModal.style.display = 'none';
  };
});

  }
});
