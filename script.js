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

// --- Manage Workouts ---
let expandedWorkoutId = null;
function renderManageWorkouts() {
  const container = document.getElementById('manageWorkoutsList');
  if (!container) return;
  container.innerHTML = '';

  Object.keys(workouts).forEach(id => {
    const w = workouts[id];
    const card = document.createElement('div');
    card.style.cssText = 'background:#2c3033; padding:10px; border-radius:6px; margin-bottom:8px;';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex; align-items:center; gap:8px; justify-content:space-between; cursor:pointer; flex-wrap:wrap;';

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex; align-items:center; gap:8px; flex:1; min-width:0;';

    const title = document.createElement('div');
    title.style.cssText = 'color:#fff; font-weight:600; min-width:0;';
    title.textContent = w.name || '(untitled)';

    const count = document.createElement('div');
    count.style.cssText = 'color:#aaa; font-size:13px;';
    count.textContent = `${(w.exercises || []).length} exercise${(w.exercises || []).length === 1 ? '' : 's'}`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(count);

    const arrow = document.createElement('div');
    arrow.style.cssText = 'color:#aaa; font-size:16px;';
    arrow.textContent = expandedWorkoutId === id ? '▾' : '▸';

    headerRow.appendChild(titleWrap);
    headerRow.appendChild(arrow);

    const content = document.createElement('div');
    content.style.cssText = 'display:none; margin-top:12px; padding-left:0; width:100%;';

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:6px;';

    const existingOrder = w?.exercises || [];
    const allExerciseIds = Object.keys(exercises || {}).sort((a, b) => {
      const ai = existingOrder.indexOf(a);
      const bi = existingOrder.indexOf(b);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    if (allExerciseIds.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#aaa; font-size:14px; padding:10px 0;';
      empty.textContent = 'No exercises available. Add exercises first.';
      list.appendChild(empty);
    } else {
      allExerciseIds.forEach(exId => {
        const ex = exercises[exId];
        const row = document.createElement('div');
        const selected = existingOrder.includes(exId);
        row.style.cssText = `display:flex; align-items:center; gap:8px; padding:8px; background:${selected ? '#2d3b52' : '#1b1d1e'}; border-radius:6px; color:#fff; cursor:pointer;`;
        row.dataset.exId = exId;
        row.dataset.selected = selected ? 'true' : 'false';

        const nameDiv = document.createElement('div');
        nameDiv.textContent = (typeof ex === 'string') ? ex : ex.name || exId;
        nameDiv.style.cssText = 'flex:1; min-width:0;';

        const typeDiv = document.createElement('div');
        typeDiv.textContent = (typeof ex === 'string') ? '' : ex.type ? ex.type : '';
        typeDiv.style.cssText = 'color:#86c3ff; font-size:13px; white-space:nowrap;';
        if (typeDiv.textContent) {
          typeDiv.style.marginRight = '8px';
        }

        const up = document.createElement('button');
        up.type = 'button';
        up.textContent = '^';
        up.title = 'Move up';
        up.style.cssText = 'flex:0 0 auto; padding:10px;';
        up.onclick = (e) => {
          e.stopPropagation();
          const prev = row.previousElementSibling;
          if (prev) list.insertBefore(row, prev);
        };

        const down = document.createElement('button');
        down.type = 'button';
        down.textContent = 'v';
        down.title = 'Move down';
        down.style.cssText = 'flex:0 0 auto; padding:10px;';
        down.onclick = (e) => {
          e.stopPropagation();
          const next = row.nextElementSibling;
          if (next) list.insertBefore(next, row);
        };

        row.onclick = (e) => {
          if (e.target.closest('button')) return;
          const isSelected = row.dataset.selected === 'true';
          row.dataset.selected = isSelected ? 'false' : 'true';
          row.style.background = row.dataset.selected === 'true' ? '#2d3b52' : '#1b1d1e';
        };

        row.appendChild(nameDiv);
        if (typeDiv.textContent) row.appendChild(typeDiv);
        row.appendChild(up);
        row.appendChild(down);
        list.appendChild(row);
      });
    }

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Changes';
    saveBtn.className = 'save';
    saveBtn.style.cssText = 'margin-top:10px; width:100%; padding:10px;';
    saveBtn.onclick = async (e) => {
      e.stopPropagation();
      const selected = [];
      list.querySelectorAll('div[data-ex-id]').forEach(row => {
        if (row.dataset.selected === 'true') selected.push(row.dataset.exId);
      });
      try {
        const wxRef = db.collection('workout-exercises');
        const existing = await wxRef.where('workoutID', '==', id).get();
        const deletePromises = [];
        existing.forEach(doc => deletePromises.push(doc.ref.delete()));
        await Promise.all(deletePromises);
        const addPromises = [];
        selected.forEach((exId, idx) => addPromises.push(wxRef.add({ workoutID: id, exerciseID: exId, order: idx })));
        await Promise.all(addPromises);
        workouts[id].exercises = selected;
        expandedWorkoutId = null;
        renderManageWorkouts();
      } catch (err) {
        console.error('Failed to save workout:', err);
        alert('Could not save workout');
      }
    };

    content.appendChild(list);
    content.appendChild(saveBtn);

    headerRow.onclick = () => {
      expandedWorkoutId = expandedWorkoutId === id ? null : id;
      renderManageWorkouts();
    };

    if (expandedWorkoutId === id) {
      content.style.display = 'block';
      arrow.textContent = '▾';
    }

    card.appendChild(headerRow);
    card.appendChild(content);
    container.appendChild(card);
  });
}

let _editingWorkoutId = null;
function showWorkoutEditForm(workoutId) {
  _editingWorkoutId = workoutId;
  const form = document.getElementById('workoutEditForm');
  const nameIn = document.getElementById('workoutNameInput');
  if (!form || !nameIn) return;
  const w = workouts[workoutId];
  nameIn.value = w?.name || '';

  // Build exercises checklist
  const list = document.getElementById('workoutExercisesList');
  if (list) {
    list.innerHTML = '';
    const existingOrder = w?.exercises || [];
    const allExerciseIds = Object.keys(exercises || {}).sort((a, b) => {
      const ai = existingOrder.indexOf(a);
      const bi = existingOrder.indexOf(b);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    allExerciseIds.forEach(exId => {
      const ex = exercises[exId];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 8px; background:#1b1d1e; margin-bottom:6px; border-radius:6px; color:#fff;';
      row.dataset.exId = exId;

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.dataset.exId = exId;
      chk.checked = (w?.exercises || []).includes(exId);

      const nameDiv = document.createElement('div');
      nameDiv.textContent = (typeof ex === 'string') ? ex : ex.name || exId;
      nameDiv.style.cssText = 'flex:1;';

      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '^';
      up.title = 'Move up';
      up.style.cssText = 'flex:0 0 auto; padding:6px; margin-left:6px;';
      up.onclick = () => {
        const prev = row.previousElementSibling;
        if (prev) list.insertBefore(row, prev);
      };

      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = 'v';
      down.title = 'Move down';
      down.style.cssText = 'flex:0 0 auto; padding:6px;';
      down.onclick = () => {
        const next = row.nextElementSibling;
        if (next) list.insertBefore(next, row);
      };

      row.appendChild(chk);
      row.appendChild(nameDiv);
      row.appendChild(up);
      row.appendChild(down);
      list.appendChild(row);
    });
  }
  form.style.display = 'block';
}

function hideWorkoutEditForm() {
  _editingWorkoutId = null;
  const form = document.getElementById('workoutEditForm');
  const nameIn = document.getElementById('workoutNameInput');
  if (!form) return;
  form.style.display = 'none';
  if (nameIn) nameIn.value = '';
  const list = document.getElementById('workoutExercisesList');
  if (list) list.innerHTML = '';
}

async function saveWorkoutEdit() {
  if (!_editingWorkoutId) return;
  const nameIn = document.getElementById('workoutNameInput');
  const name = nameIn?.value?.trim();
  const list = document.getElementById('workoutExercisesList');
  const selected = [];
  if (list) {
    // read rows in DOM order to preserve order
    list.querySelectorAll('div[data-ex-id]').forEach(row => {
      const chk = row.querySelector('input[type=checkbox]');
      if (chk && chk.checked) selected.push(row.dataset.exId);
    });
  }
  if (!name) { alert('Enter workout name'); return; }
  try {
    await db.collection('workouts').doc(_editingWorkoutId).set({ name }, { merge: true });
    workouts[_editingWorkoutId].name = name;
    // Update workout-exercises mapping: remove existing entries then add new ones
    const wxRef = db.collection('workout-exercises');
    const existing = await wxRef.where('workoutID', '==', _editingWorkoutId).get();
    const deletePromises = [];
    existing.forEach(doc => { deletePromises.push(doc.ref.delete()); });
    await Promise.all(deletePromises);
    const addPromises = [];
    selected.forEach((exId, idx) => {
      addPromises.push(wxRef.add({ workoutID: _editingWorkoutId, exerciseID: exId, order: idx }));
    });
    await Promise.all(addPromises);
    workouts[_editingWorkoutId].exercises = selected;
    renderManageWorkouts();
    hideWorkoutEditForm();
  } catch (e) {
    console.error('Failed to save workout:', e);
    alert('Could not save workout');
  }
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

async function refreshExerciseView() {
  if (activeTab === 'history') {
    await loadHistory();
  } else {
    loadExercise();
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

  return aTime - bTime; // oldest -> newest
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
        const data = doc.data();
        exercises[doc.id] = {
          name: data.name || "",
          type: data.type || ""
        };
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
        const data = doc.data();
        workouts[doc.id] = { name: data.name || '', type: data.type || '', exercises: [] };
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
      workoutModal.style.display = 'none';
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

  const exName = (typeof exercises[exId] === 'string' ? exercises[exId] : exercises[exId]?.name) || "Exercise";
  const exType = (typeof exercises[exId] === 'string' ? '' : exercises[exId]?.type) || "";
  const setsHTML = getSets(exId);

  // Reset inputs if switching exercises (unless editing)
if (editingSetId === null && (inputState.lastExId !== exId || lastLoadedDate !== currentDate)) {
  const setsToday = logCache[currentDate]?.[currentWorkoutId] || [];

  // Last set for this exercise **today**
  const lastSetToday = [...setsToday].reverse().find(s => s.exerciseID === exId);

  // Last inputs memory for this exercise today
  const lastInput = lastInputByDate[currentDate]?.[exId] || {};

  inputState = {
    weight: lastSetToday?.weight ?? lastInput.weight ?? "",
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
      refreshExerciseView();

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
      ${exType ? `<div style="color:#aaa; font-size:13px; margin-bottom:16px; text-transform:uppercase; letter-spacing:0.5px;">${exType}</div>` : ''}

      <div class="tabs">
  <button class="tab ${activeTab === 'track' ? 'active' : ''}" onclick="switchTab('track')">Track</button>
  <button class="tab ${activeTab === 'history' ? 'active' : ''}" onclick="switchTab('history')">History</button>
</div>

      ${activeTab === 'track' ? `
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
      ` : ''}

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
    return aTime - bTime; // oldest -> newest
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
    ${hasNote ? `<div class="sets-pill-note" title="Notes">📝</div>` : ``}
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

  let weight = document.getElementById("weight").value;
  const reps = document.getElementById("reps").value;

  // Fix: safely handle notes
  const notesEl = document.getElementById("notes");
  const notes = notesEl ? notesEl.value : "";

  if(!weight){
    weight = "0";
  }

  inputState = { weight, reps, notes, lastExId: exId };

  if(!reps){
    alert("Enter reps");
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
    refreshExerciseView();
  } else {
    alert("Workout Complete!");
    currentIndex = 0;
    refreshExerciseView();
  }
}

// --- Load workout ---
function loadWorkout(workoutId){
  currentWorkoutId = workoutId;
  currentIndex = 0;
  updateTabs(workoutId);
  refreshExerciseView();
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
  refreshExerciseView();
  updateTodayWorkoutName();
};

    workoutList.appendChild(btn);
  });
}

function renderExercisesList() {
  if (!exerciseList) return;

  exerciseList.innerHTML = "";

  const exerciseIds = Object.keys(exercises);
  if (exerciseIds.length === 0) {
    exerciseList.innerHTML = "<p style='color:#aaa; text-align:center;'>No exercises yet</p>";
    return;
  }

  // Group exercises by type
  const grouped = {};
  const typeOrder = ['Chest', 'Back', 'Shoulders', 'Legs', 'Triceps', 'Biceps', 'Abs'];

  exerciseIds.forEach((id) => {
    const ex = exercises[id];
    const exType = (typeof ex === 'string' ? '' : ex.type) || 'Other';
    if (!grouped[exType]) {
      grouped[exType] = [];
    }
    grouped[exType].push({ id, name: typeof ex === 'string' ? ex : ex.name });
  });

  // Sort types with predefined order first, then others
  const sortedTypes = [
    ...typeOrder.filter(t => grouped[t]),
    ...Object.keys(grouped).filter(t => !typeOrder.includes(t))
  ];

  // Render collapsible sections
  sortedTypes.forEach((type) => {
    const items = grouped[type];
    const sectionId = `exercise-section-${type}`;
    const contentId = `exercise-content-${type}`;

    const section = document.createElement('div');
    section.style.cssText = "margin-bottom:12px;";

    const header = document.createElement('div');
    header.style.cssText = "background:#1e2225; padding:12px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:8px; user-select: none;";
    header.innerHTML = `<span style="color:#6c3483; font-weight:bold;">&gt;
  </span><span style="color:#fff; font-weight:600;">${type}</span><span style="color:#aaa; font-size:12px;margin-left:auto;">${items.length}</span>`;
    header.onclick = () => {
      const content = document.getElementById(contentId);
      const arrow = header.querySelector('span');
        if (content.style.display === 'none') {
          content.style.display = 'block';
          arrow.textContent = 'v';
        } else {
          content.style.display = 'none';
          arrow.textContent = '>';
        }
    };

    const content = document.createElement('div');
    content.id = contentId;
    content.style.cssText = "display:none; padding-left:8px; margin-top:8px;";

    items.forEach((item) => {
      const itemDiv = document.createElement('div');
      itemDiv.style.cssText = "background:#2c3033; padding:10px 12px; border-radius:6px; margin-bottom:8px; color:#fff; font-size:14px;";
      itemDiv.textContent = item.name;
      content.appendChild(itemDiv);
    });

    section.appendChild(header);
    section.appendChild(content);
    exerciseList.appendChild(section);
  });
}

function showExerciseForm() {
  const exerciseForm = document.getElementById('exerciseForm');
  const exerciseName = document.getElementById('exerciseName');
  if (exerciseForm) {
    exerciseForm.style.display = 'block';
    if (exerciseName) exerciseName.focus();
  }
}

function hideExerciseForm() {
  const exerciseForm = document.getElementById('exerciseForm');
  const exerciseName = document.getElementById('exerciseName');
  const exerciseType = document.getElementById('exerciseType');
  if (exerciseForm) {
    exerciseForm.style.display = 'none';
    if (exerciseName) exerciseName.value = '';
    if (exerciseType) exerciseType.value = '';
  }
}

async function saveExercise() {
  const exerciseName = document.getElementById('exerciseName');
  const exerciseType = document.getElementById('exerciseType');
  if (!exerciseName || !exerciseName.value.trim()) {
    alert('Enter an exercise name');
    return;
  }

  const name = exerciseName.value.trim();
  const type = exerciseType ? exerciseType.value : '';

  try {
    const docRef = await db.collection("exercises").add({ name, type });
    exercises[docRef.id] = { name, type };
    renderExercisesList();
    hideExerciseForm();
  } catch (e) {
    console.error('Failed to save exercise:', e);
    alert('Could not save exercise');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const calendarBtn = document.getElementById('calendarBtn');
  const calendarModal = document.getElementById('calendarModal');
  const closeCalendarModal = document.getElementById('closeCalendarModal');
  const fullCalendar = document.getElementById('fullCalendar');
  const menuDropdown = document.getElementById('menuDropdown');
  const openCalendar = document.getElementById('openCalendar');
  const openWorkouts = document.getElementById('openWorkouts');
  const openExercises = document.getElementById('openExercises');
  const workoutModal = document.getElementById('workoutModal');
  const closeWorkoutModal = document.getElementById('closeWorkoutModal');
  const workoutList = document.getElementById('workoutList');
  const exercisesModal = document.getElementById('exercisesModal');
  const closeExerciseModal = document.getElementById('closeExerciseModal');
  const exerciseList = document.getElementById('exerciseList');
  const manageWorkoutsBtn = document.getElementById('manageWorkoutsBtn');
  const manageWorkoutsModal = document.getElementById('manageWorkoutsModal');
  const closeManageWorkoutsModal = document.getElementById('closeManageWorkoutsModal');
  const manageWorkoutsList = document.getElementById('manageWorkoutsList');
  const workoutEditSave = document.getElementById('workoutEditSave');
  const workoutEditCancel = document.getElementById('workoutEditCancel');

  if (!calendarBtn || !calendarModal || !closeCalendarModal || !fullCalendar) return;

  // v Toggle menu
  calendarBtn.onclick = (e) => {
    e.stopPropagation();
    menuDropdown.style.display =
      menuDropdown.style.display === 'block' ? 'none' : 'block';
  };

  // Calendar Open calendar from menu
  openCalendar.onclick = () => {
    menuDropdown.style.display = 'none';
    calendarModal.style.display = 'flex';
    renderFullCalendar();
  };

  // Close Close calendar modal
  closeCalendarModal.onclick = () => {
    calendarModal.style.display = 'none';
  };

  openWorkouts.onclick = () => {
  menuDropdown.style.display = 'none';
  calendarBtn.classList.remove('open');

  workoutModal.style.display = 'flex';
  renderWorkoutList();
 
};

  if (manageWorkoutsBtn) {
    manageWorkoutsBtn.onclick = () => {
      menuDropdown.style.display = 'none';
      workoutModal.style.display = 'none';
      manageWorkoutsModal.style.display = 'flex';
      renderManageWorkouts();
    };
  }

  openExercises.onclick = () => {
    menuDropdown.style.display = 'none';
    calendarBtn.classList.remove('open');
    exercisesModal.style.display = 'flex';
    renderExercisesList();
  };

closeWorkoutModal.onclick = () => {
  workoutModal.style.display = 'none';
};


closeExerciseModal.onclick = () => {
  exercisesModal.style.display = 'none';
  hideExerciseForm();
};

if (closeManageWorkoutsModal) {
  closeManageWorkoutsModal.onclick = () => {
    manageWorkoutsModal.style.display = 'none';
    hideWorkoutEditForm();
  };
}

if (workoutEditSave) workoutEditSave.onclick = () => saveWorkoutEdit();
if (workoutEditCancel) workoutEditCancel.onclick = () => hideWorkoutEditForm();

const addExerciseBtn = document.getElementById('addExerciseBtn');
const exerciseFormSave = document.getElementById('exerciseFormSave');
const exerciseFormCancel = document.getElementById('exerciseFormCancel');

if (addExerciseBtn) {
  addExerciseBtn.onclick = () => showExerciseForm();
}

if (exerciseFormSave) {
  exerciseFormSave.onclick = () => saveExercise();
}

if (exerciseFormCancel) {
  exerciseFormCancel.onclick = () => hideExerciseForm();
}



window.changeMonth = function(offset) {
  calendarDate.setMonth(calendarDate.getMonth() + offset);
  renderFullCalendar();
};



  //  Close menu if clicking outside
  document.addEventListener('click', () => {
    menuDropdown.style.display = 'none';
  });

  //  FULL calendar function (real one)
  function renderFullCalendar() {
    const month = calendarDate.getMonth();
const year = calendarDate.getFullYear();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekday = firstDay.getDay();

    let html = `
  <div class="full-calendar-header">
    <button class="cal-nav" onclick="changeMonth(-1)"><</button>
    <span>${calendarDate.toLocaleString('default', { month: 'long' })} ${year}</span>
    <button class="cal-nav" onclick="changeMonth(1)">></button>
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

    const todayIso = getLocalISODate();
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = getLocalISODate(new Date(year, month, day));
      const isSelected = iso === currentDate;
      const isToday = iso === todayIso;
      const classes = [isSelected ? 'selected' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
      const dayLogs = logCache[iso] || {};
      const workoutIds = Object.keys(dayLogs);

      const dotsHTML = workoutIds.map(wId => {
        const color = workoutColors[wId] || "#888";
        return `<span class="calendar-dot" style="background:${color}"></span>`;
      }).join("");

      html += `
  <div class='full-calendar-day ${classes}' data-iso='${iso}'>
    <div>${day}</div>
    <div class="calendar-dots">${dotsHTML}</div>
  </div>
`;
    }

    html += `</div>`;
   
    html += `</div>`;

//  ADD LEGEND HERE
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

//  THEN render
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
      //  Workout exists > load it
      currentWorkoutId = existingWorkoutIds[0];
      currentIndex = 0;
      loadExercise();
      updateTodayWorkoutName();
    } else {
      // No workout yet - open modal to select
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
