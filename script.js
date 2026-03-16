// -------------------- Firebase Setup --------------------
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "YOUR_MSG_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// -------------------- Variables --------------------
let currentWorkout = "A";
let currentIndex = 0;
let navigationDirection = "next";
let currentDate = getLocalISODate();
let rest = 90;
let interval;

let exercisesMap = {};         // { id: name }
let exerciseNameToID = {};     // { name: id }
let workoutsMap = {};          // { A: [ids], B: [ids] }
const workouts = { A: [], B: [] };

// Local cache for instant load
let logCache = {}; // { date: { workout: [sets] } }

// -------------------- Utility --------------------
function getLocalISODate(d = new Date()) {
  const tzo = d.getTimezoneOffset();
  return new Date(d.getTime() - tzo * 60 * 1000).toISOString().slice(0, 10);
}

// -------------------- Timer --------------------
function updateTimerDisplay() {
  document.getElementById("timer").innerText = rest;
}
function startTimer() {
  clearInterval(interval);
  rest = 90;
  updateTimerDisplay();
  interval = setInterval(() => {
    rest--;
    updateTimerDisplay();
    if (rest <= 0) {
      clearInterval(interval);
      alert("Rest done 💪");
    }
  }, 1000);
}

// -------------------- Input Adjustments --------------------
function changeValue(id, amount) {
  const el = document.getElementById(id);
  let newValue = parseFloat(el.value || 0) + amount;
  if (newValue < 0) newValue = 0;
  el.value = newValue;
}

// -------------------- Calendar --------------------
function generateCalendar() {
  const cal = document.getElementById("calendar");
  cal.innerHTML = "";
  const today = new Date();
  for (let i = -7; i < 7; i++) {
    const d = new Date(); d.setDate(today.getDate() + i);
    const iso = getLocalISODate(d);
    const dayDiv = document.createElement("div");
    dayDiv.className = "day";
    if (iso === currentDate) dayDiv.classList.add("today");
    const completed = logCache[iso]?.[currentWorkout]?.length;
    if (completed) dayDiv.classList.add("completed");
    dayDiv.innerHTML = `${d.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)}<br>${d.getDate()}`;
    dayDiv.onclick = () => { currentDate = iso; loadExercise(); generateCalendar(); };
    cal.appendChild(dayDiv);
  }
  const todayEl = document.querySelector(".day.today");
  if (todayEl) todayEl.scrollIntoView({ behavior: "smooth", inline: "center" });
}

// -------------------- Load Exercise Card --------------------
function getSets(ex) {
  const sets = logCache[currentDate]?.[currentWorkout] || [];
  const filtered = sets.filter(s => s.exercise === ex).slice(-5);
  return filtered.map((s, i) => {
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

function loadExercise() {
  const container = document.getElementById("exerciseCard");
  const ex = workouts[currentWorkout][currentIndex];
  const weightVal = document.getElementById("weight")?.value || "";
  const repsVal = document.getElementById("reps")?.value || "";
  const notesVal = document.getElementById("notes")?.value || "";

  container.innerHTML = `<div class="card">
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

// -------------------- Save & Delete Sets --------------------
async function saveSet() {
  const ex = workouts[currentWorkout][currentIndex];
  const weight = document.getElementById("weight").value;
  const reps = document.getElementById("reps").value;
  const notes = document.getElementById("notes")?.value || "";
  if (!weight || !reps) { alert("Please enter weight and reps"); return; }

  const exID = exerciseNameToID[ex];

  try {
    const docRef = await db.collection('workouts').add({
      date: currentDate,
      workout: currentWorkout,
      exerciseID: exID,
      exercise: ex,
      weight,
      reps,
      notes
    });

    // update local cache immediately
    if (!logCache[currentDate]) logCache[currentDate] = {};
    if (!logCache[currentDate][currentWorkout]) logCache[currentDate][currentWorkout] = [];
    logCache[currentDate][currentWorkout].push({
      id: docRef.id,
      exercise: ex,
      weight,
      reps,
      notes
    });

    startTimer(); loadExercise(); generateCalendar();

  } catch(e) {
    console.error("Error saving set", e);
    alert("Failed to save set. Check internet connection.");
  }
}

async function deleteSet(docID) {
  if (!confirm("Delete this set?")) return;

  try {
    await db.collection('workouts').doc(docID).delete();

    // update local cache
    for (let date in logCache) {
      for (let workout in logCache[date]) {
        logCache[date][workout] = logCache[date][workout].filter(s => s.id !== docID);
      }
    }

    loadExercise();
    generateCalendar();
  } catch (e) {
    console.error(e);
    alert("Delete failed");
  }
}

// -------------------- Load Data --------------------
async function loadData() {
  try {
    // Load exercises & workouts structure (could be hardcoded or fetched from Firestore)
    const exercisesSnap = await db.collection('exercises').get();
    exercisesMap = {};
    exerciseNameToID = {};
    exercisesSnap.forEach(doc => {
      const d = doc.data();
      exercisesMap[d.id] = d.name;
      exerciseNameToID[d.name] = d.id;
    });

    const workoutsSnap = await db.collection('workouts').get();
    logCache = {};
    workoutsSnap.forEach(doc => {
      const set = doc.data();
      if (!logCache[set.date]) logCache[set.date] = {};
      if (!logCache[set.date][set.workout]) logCache[set.date][set.workout] = [];
      logCache[set.date][set.workout].push({
        id: doc.id,
        exercise: set.exercise,
        weight: set.weight,
        reps: set.reps,
        notes: set.notes
      });
    });

    // Build workouts array (optional: could hardcode A/B)
    workouts.A = Object.values(exercisesMap); // temporary example
    workouts.B = Object.values(exercisesMap); // could be different

    loadExercise();
    generateCalendar();
  } catch(e) {
    console.error(e);
    alert("Failed to load data");
  }
}

// -------------------- Navigation --------------------
function nextExercise() {
  navigationDirection = "next";
  if (currentIndex < workouts[currentWorkout].length - 1) {
    currentIndex++; 
    loadExercise();
  } else {
    alert("Workout Complete! 🎉"); 
    currentIndex = 0; 
    loadExercise();
  }
}

function updateTabs(type) {
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.workout === type);
  });
}

function loadWorkout(type) {
  currentWorkout = type; 
  currentIndex = 0; 
  updateTabs(type); 
  loadExercise(); 
  generateCalendar();
}

// -------------------- Swipe --------------------
let touchStartX = 0;
const cardContainer = document.getElementById("exerciseCard");
if (cardContainer) {
  cardContainer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].clientX; });
  cardContainer.addEventListener('touchend', e => {
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 50) {
      navigationDirection = delta < 0 ? "next" : "prev";
      delta < 0 ? nextExercise() : currentIndex > 0 && currentIndex--;
      loadExercise();
    }
  });
}

// -------------------- Initial Load --------------------
loadData();
updateTabs(currentWorkout);
updateTimerDisplay();
