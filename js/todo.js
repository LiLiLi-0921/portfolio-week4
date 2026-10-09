/* =========================================================
   To-Do list app — projects.html
   Backend: Supabase (todos table)
     - id            (int, server-generated)
     - task          (text)        ← app "text"
     - is_complete   (bool)        ← app "done"
     - date          (date)        ← app "date"
     - created_at    (timestamptz) ← server-generated, used for ordering
   Local-only (no DB column): emoji, priority
     → kept in localStorage keyed by task id
   ========================================================= */
(function () {
  "use strict";

  /* ---------- Supabase config ---------- */
  var SUPABASE_URL = "https://xqxfveramtvsiwtbauzh.supabase.co";
  var SUPABASE_KEY = "sb_publishable_oxvdoQ7xga2vq4dVOav3Qg_A5WKNFFq";
  var REST_URL     = SUPABASE_URL + "/rest/v1/todos";
  var META_KEY     = "jl-todo-meta-v1";

  function authHeaders(extra) {
    var h = {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json"
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  /* ---------- State ---------- */
  var state = {
    tasks: [],                    // populated by fetchTasks() on init
    meta: loadMeta(),             // {id: {emoji, priority}}
    selectedEmoji: null,
    selectedPriority: "medium",
    selectedDate: null,
    viewYear: null,
    viewMonth: null,
    loading: true,
    error: null
  };
  var errorTimer = null;

  /* ---------- DOM refs ---------- */
  var $input       = document.getElementById("todo-input");
  var $addBtn      = document.getElementById("todo-add");
  var $emojiBtn    = document.getElementById("todo-emoji-btn");
  var $emojiLabel  = document.getElementById("todo-emoji-label");
  var $emojiPop    = document.getElementById("todo-emoji-pop");
  var $emojiGrid   = document.getElementById("emoji-grid");
  var $priorityRow = document.querySelector(".todo-priority");
  var $dateBtn     = document.getElementById("todo-date-btn");
  var $dateLabel   = document.getElementById("todo-date-label");
  var $calendar    = document.getElementById("todo-calendar");
  var $calPrev     = document.getElementById("cal-prev");
  var $calNext     = document.getElementById("cal-next");
  var $calTitle    = document.getElementById("cal-month-year");
  var $calGrid     = document.getElementById("cal-grid");
  var $list        = document.getElementById("todo-list");
  var $empty       = document.getElementById("todo-empty");
  var $count       = document.getElementById("todo-count");
  var $clearBtn    = document.getElementById("todo-clear");

  var MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

  var EMOJIS = [
    "✨","📌","🔥","⭐","🎯","💡","📝","✉️",
    "📚","🎨","💻","📞","🏠","🏃","🍳","🛒",
    "💼","🌱","🎉","⚠️","❓","💤","☕","🎵"
  ];

  /* ---------- localStorage metadata (emoji + priority) ---------- */
  function loadMeta() {
    try {
      var raw = localStorage.getItem(META_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === "object") ? obj : {};
    } catch (e) { return {}; }
  }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(state.meta)); }
    catch (e) { /* ignore */ }
  }
  function setMeta(id, fields) {
    state.meta[id] = Object.assign({}, state.meta[id], fields);
    saveMeta();
  }

  /* ---------- Supabase API ---------- */
  // Convert a DB row → app task object (merged with localStorage meta)
  function mergeTask(row) {
    var meta = state.meta[row.id] || {};
    return {
      id: row.id,
      text: row.task,
      done: !!row.is_complete,
      date: row.date || null,
      created_at: row.created_at,
      emoji: meta.emoji || null,
      priority: meta.priority || "medium"
    };
  }

  async function fetchTasks() {
    var url = REST_URL + "?select=id,task,is_complete,date,created_at&order=created_at.asc";
    var res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error("Failed to load tasks (HTTP " + res.status + ")");
    var rows = await res.json();
    return rows.map(mergeTask);
  }

  async function insertTask(payload) {
    var res = await fetch(REST_URL, {
      method: "POST",
      headers: authHeaders({ "Prefer": "return=representation" }),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.message || "Failed to add task");
    }
    var rows = await res.json();
    return rows[0];
  }

  async function deleteTask(id) {
    var res = await fetch(REST_URL + "?id=eq." + encodeURIComponent(id), {
      method: "DELETE",
      headers: authHeaders()
    });
    if (!res.ok && res.status !== 204) {
      throw new Error("Failed to delete task");
    }
  }

  async function patchTask(id, patch) {
    var res = await fetch(REST_URL + "?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: authHeaders({ "Prefer": "return=representation" }),
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.message || "Failed to update task");
    }
    var rows = await res.json();
    return rows[0];
  }

  async function deleteAllTasks(ids) {
    // Delete every task id in one request using the `in` filter
    if (!ids || ids.length === 0) return;
    var filter = "id=in.(" + ids.join(",") + ")";
    var res = await fetch(REST_URL + "?" + filter, {
      method: "DELETE",
      headers: authHeaders()
    });
    if (!res.ok && res.status !== 204) {
      throw new Error("Failed to clear tasks");
    }
  }

  /* ---------- Date helpers ---------- */
  function startOfDay(d) {
    var n = new Date(d); n.setHours(0, 0, 0, 0); return n;
  }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }
  function fmtDate(d) {
    var m = ["Jan","Feb","Mar","Apr","May","Jun",
            "Jul","Aug","Sep","Oct","Nov","Dec"];
    return m[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  /* ---------- Emoji picker ---------- */
  function renderEmojiGrid() {
    $emojiGrid.innerHTML = "";
    EMOJIS.forEach(function (em) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = em;
      btn.setAttribute("aria-label", "Choose emoji " + em);
      if (state.selectedEmoji === em) btn.classList.add("selected");
      btn.addEventListener("click", function () {
        state.selectedEmoji = (state.selectedEmoji === em) ? null : em;
        updateEmojiLabel();
        renderEmojiGrid();
        closeEmojiPop();
      });
      $emojiGrid.appendChild(btn);
    });
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "clear";
    clear.textContent = "CLEAR";
    clear.setAttribute("aria-label", "Clear emoji");
    clear.addEventListener("click", function () {
      state.selectedEmoji = null;
      updateEmojiLabel();
      renderEmojiGrid();
      closeEmojiPop();
    });
    $emojiGrid.appendChild(clear);
  }
  function updateEmojiLabel() {
    if (state.selectedEmoji) {
      $emojiLabel.textContent = state.selectedEmoji;
      $emojiBtn.classList.add("active");
    } else {
      $emojiLabel.textContent = "✨";
      $emojiBtn.classList.remove("active");
    }
  }
  function openEmojiPop() {
    renderEmojiGrid();
    $emojiPop.hidden = false;
    $emojiBtn.setAttribute("aria-expanded", "true");
  }
  function closeEmojiPop() {
    $emojiPop.hidden = true;
    $emojiBtn.setAttribute("aria-expanded", "false");
  }
  function toggleEmojiPop() {
    if ($emojiPop.hidden) openEmojiPop(); else closeEmojiPop();
  }

  /* ---------- Priority picker ---------- */
  function renderPriority() {
    var btns = $priorityRow.querySelectorAll(".prio-btn");
    btns.forEach(function (btn) {
      if (btn.getAttribute("data-prio") === state.selectedPriority) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  /* ---------- Calendar rendering ---------- */
  function openCalendar() {
    var base = state.selectedDate ? new Date(state.selectedDate) : new Date();
    state.viewYear  = base.getFullYear();
    state.viewMonth = base.getMonth();
    renderCalendar();
    $calendar.hidden = false;
    $dateBtn.setAttribute("aria-expanded", "true");
  }
  function closeCalendar() {
    $calendar.hidden = true;
    $dateBtn.setAttribute("aria-expanded", "false");
  }
  function toggleCalendar() {
    if ($calendar.hidden) openCalendar(); else closeCalendar();
  }

  function renderCalendar() {
    $calTitle.textContent = MONTHS[state.viewMonth] + " " + state.viewYear;
    var first = new Date(state.viewYear, state.viewMonth, 1);
    var startWeekday = first.getDay();
    var daysInMonth  = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
    var today = startOfDay(new Date());

    $calGrid.innerHTML = "";
    for (var i = 0; i < startWeekday; i++) {
      var blank = document.createElement("span");
      blank.className = "cal-day disabled";
      blank.setAttribute("aria-hidden", "true");
      $calGrid.appendChild(blank);
    }
    for (var d = 1; d <= daysInMonth; d++) {
      (function (day) {
        var cellDate = new Date(state.viewYear, state.viewMonth, day);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cal-day";
        btn.textContent = String(day);
        btn.setAttribute("role", "gridcell");
        if (isSameDay(cellDate, today))   btn.classList.add("today");
        if (state.selectedDate && isSameDay(cellDate, state.selectedDate))
          btn.classList.add("selected");
        btn.addEventListener("click", function () {
          state.selectedDate = cellDate;
          updateDateLabel();
          renderCalendar();
          closeCalendar();
        });
        $calGrid.appendChild(btn);
      })(d);
    }
  }

  function shiftMonth(delta) {
    state.viewMonth += delta;
    if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
    if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
    renderCalendar();
  }

  function updateDateLabel() {
    if (state.selectedDate) {
      $dateLabel.textContent = fmtDate(state.selectedDate);
      $dateBtn.classList.add("has-date");
    } else {
      $dateLabel.textContent = "Pick a date";
      $dateBtn.classList.remove("has-date");
    }
  }

  /* ---------- Error display ---------- */
  function showError(msg) {
    state.error = msg;
    render();
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(function () {
      state.error = null;
      render();
    }, 3000);
  }

  /* ---------- Task list rendering ---------- */
  var PRIO_WEIGHT = { high: 0, medium: 1, low: 2 };

  function render() {
    $list.innerHTML = "";

    // Loading / error states take over the empty slot
    if (state.loading) {
      $empty.style.display = "block";
      $empty.textContent = "Loading tasks…";
      $empty.style.color = "";
      $count.textContent = "";
      return;
    }
    if (state.error) {
      $empty.style.display = "block";
      $empty.textContent = "⚠ " + state.error;
      $empty.style.color = "#b9453f";
      $count.textContent = "";
      return;
    }

    $empty.style.color = "";
    $empty.textContent = "No tasks yet — add one above!";

    if (state.tasks.length === 0) {
      $empty.style.display = "block";
    } else {
      $empty.style.display = "none";
    }

    // Sort: incomplete first, then priority (high→low), then by date,
    // falling back to created_at for stable ordering
    var sorted = state.tasks.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      var pw = (PRIO_WEIGHT[a.priority] || 1) - (PRIO_WEIGHT[b.priority] || 1);
      if (pw !== 0) return pw;
      if (a.date && b.date) return new Date(a.date) - new Date(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      if (a.created_at && b.created_at)
        return new Date(a.created_at) - new Date(b.created_at);
      return 0;
    });

    sorted.forEach(function (task) {
      var li = document.createElement("li");
      li.className = "todo-item prio-" + (task.priority || "medium");
      if (task.done) li.classList.add("done");
      li.dataset.id = task.id;

      // Checkbox
      var label = document.createElement("label");
      label.className = "todo-check";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = task.done;
      cb.setAttribute("aria-label", "Mark task done");
      cb.addEventListener("change", async function () {
        var newDone = cb.checked;
        task.done = newDone;
        render();
        try {
          await patchTask(task.id, { is_complete: newDone });
        } catch (e) {
          task.done = !newDone;
          render();
          showError(e.message);
        }
      });
      var box = document.createElement("span");
      box.className = "box";
      box.setAttribute("aria-hidden", "true");
      label.appendChild(cb);
      label.appendChild(box);

      li.appendChild(label);

      // Emoji (if any)
      if (task.emoji) {
        var em = document.createElement("span");
        em.className = "todo-emoji-icon";
        em.textContent = task.emoji;
        em.setAttribute("aria-hidden", "true");
        li.appendChild(em);
      }

      // Text (inline editable)
      var text = document.createElement("span");
      text.className = "todo-text";
      text.textContent = task.text;
      text.title = "Click to edit";
      text.addEventListener("click", function () { startEdit(text, task); });
      li.appendChild(text);

      // Priority chip
      var prioChip = document.createElement("span");
      prioChip.className = "todo-prio-chip " + (task.priority || "medium");
      prioChip.textContent = task.priority || "medium";
      li.appendChild(prioChip);

      // Date chip
      if (task.date) {
        var chip = document.createElement("span");
        chip.className = "todo-date-chip";
        chip.textContent = "📅 " + fmtDate(new Date(task.date));
        li.appendChild(chip);
      }

      // Delete button (×)
      var del = document.createElement("button");
      del.type = "button";
      del.className = "todo-del";
      del.textContent = "×";
      del.setAttribute("aria-label", "Delete task");
      del.title = "Delete";
      del.addEventListener("click", async function () {
        // Optimistic: remove from state + meta immediately
        var snapshot = task;
        state.tasks = state.tasks.filter(function (t) { return t.id !== task.id; });
        render();
        try {
          await deleteTask(task.id);
          delete state.meta[task.id];
          saveMeta();
        } catch (e) {
          // Restore on failure
          state.tasks.push(snapshot);
          render();
          showError(e.message);
        }
      });
      li.appendChild(del);

      $list.appendChild(li);
    });

    // Count summary
    var done = state.tasks.filter(function (t) { return t.done; }).length;
    var total = state.tasks.length;
    $count.textContent = total
      ? (done + " of " + total + " tasks completed")
      : "";
  }

  /* ---------- Inline edit ---------- */
  function startEdit(textEl, task) {
    if (textEl.classList.contains("editing")) return;

    var input = document.createElement("input");
    input.type = "text";
    input.className = "todo-text-input";
    input.value = task.text;
    input.maxLength = 120;

    textEl.classList.add("editing");
    textEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(0, input.value.length);

    var finished = false;
    async function finish(save) {
      if (finished) return;
      finished = true;
      var val = input.value.trim();
      if (save && val && val !== task.text) {
        var oldText = task.text;
        task.text = val;
        render();
        try {
          await patchTask(task.id, { task: val });
        } catch (e) {
          task.text = oldText;
          render();
          showError(e.message);
        }
      } else {
        render();
      }
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }

  /* ---------- Add task ---------- */
  async function addTask() {
    var text = $input.value.trim();
    if (!text) {
      $input.focus();
      $input.style.borderColor = "#b9453f";
      setTimeout(function () { $input.style.borderColor = ""; }, 1200);
      return;
    }
    $addBtn.disabled = true;
    try {
      var row = await insertTask({
        task: text,
        is_complete: false,
        date: state.selectedDate
          ? state.selectedDate.toISOString().slice(0, 10) // YYYY-MM-DD
          : null
      });
      // Attach the currently-selected emoji/priority as local metadata
      setMeta(row.id, {
        emoji: state.selectedEmoji,
        priority: state.selectedPriority
      });
      state.tasks.push(mergeTask(row));

      // Reset inputs
      $input.value = "";
      state.selectedEmoji = null;
      state.selectedPriority = "medium";
      state.selectedDate = null;
      updateEmojiLabel();
      updateDateLabel();
      renderPriority();
      closeCalendar();
      closeEmojiPop();
      render();
    } catch (e) {
      showError(e.message);
    } finally {
      $addBtn.disabled = false;
      $input.focus();
    }
  }

  /* ---------- Clear all ---------- */
  async function clearAll() {
    if (state.tasks.length === 0) return;
    if (!confirm("Remove all tasks? This can't be undone.")) return;
    var snapshot = state.tasks.slice();
    var ids = state.tasks.map(function (t) { return t.id; });
    state.tasks = [];
    render();
    try {
      await deleteAllTasks(ids);
      state.meta = {};
      saveMeta();
    } catch (e) {
      state.tasks = snapshot;
      render();
      showError(e.message);
    }
  }

  /* ---------- Wire up events ---------- */
  $addBtn.addEventListener("click", addTask);
  $input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); addTask(); }
  });
  $emojiBtn.addEventListener("click", toggleEmojiPop);
  $priorityRow.addEventListener("click", function (e) {
    var btn = e.target.closest(".prio-btn");
    if (!btn) return;
    state.selectedPriority = btn.getAttribute("data-prio");
    renderPriority();
  });
  $dateBtn.addEventListener("click", toggleCalendar);
  $calPrev.addEventListener("click", function () { shiftMonth(-1); });
  $calNext.addEventListener("click", function () { shiftMonth(1); });
  $clearBtn.addEventListener("click", clearAll);

  // Close popovers when clicking outside
  document.addEventListener("click", function (e) {
    if (!$calendar.hidden &&
        !$calendar.contains(e.target) && !$dateBtn.contains(e.target)) {
      closeCalendar();
    }
    if (!$emojiPop.hidden &&
        !$emojiPop.contains(e.target) && !$emojiBtn.contains(e.target)) {
      closeEmojiPop();
    }
  });
  // Escape closes popovers
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!$calendar.hidden) closeCalendar();
      if (!$emojiPop.hidden) closeEmojiPop();
    }
  });

  /* ---------- Init ---------- */
  updateEmojiLabel();
  updateDateLabel();
  renderPriority();
  render(); // shows "Loading tasks…"
  (async function init() {
    try {
      state.tasks = await fetchTasks();
    } catch (e) {
      state.error = e.message;
    } finally {
      state.loading = false;
      render();
    }
  })();
})();
