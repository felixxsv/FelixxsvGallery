const DAY_MS = 24 * 60 * 60 * 1000;
const INSTANCE_MAP = new WeakMap();
const INPUT_VALUE_DESCRIPTOR = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

const UI_STRINGS = {
  en: { selectDate: "Select date", today: "Today", clear: "Clear", previousMonth: "Previous month", nextMonth: "Next month" },
  ja: { selectDate: "日付を選択", today: "今日", clear: "クリア", previousMonth: "前の月", nextMonth: "次の月" },
  de: { selectDate: "Datum wählen", today: "Heute", clear: "Löschen", previousMonth: "Vorheriger Monat", nextMonth: "Nächster Monat" },
  fr: { selectDate: "Choisir une date", today: "Aujourd'hui", clear: "Effacer", previousMonth: "Mois précédent", nextMonth: "Mois suivant" },
  ru: { selectDate: "Выбрать дату", today: "Сегодня", clear: "Очистить", previousMonth: "Предыдущий месяц", nextMonth: "Следующий месяц" },
  es: { selectDate: "Seleccionar fecha", today: "Hoy", clear: "Borrar", previousMonth: "Mes anterior", nextMonth: "Mes siguiente" },
  zh: { selectDate: "选择日期", today: "今天", clear: "清除", previousMonth: "上个月", nextMonth: "下个月" },
  ko: { selectDate: "날짜 선택", today: "오늘", clear: "지우기", previousMonth: "이전 달", nextMonth: "다음 달" },
};

function getLocalePrefix(locale) {
  return String(locale || "en-US").trim().toLowerCase().split("-")[0] || "en";
}

function getStrings(locale) {
  const prefix = getLocalePrefix(locale);
  return UI_STRINGS[prefix] || UI_STRINGS.en;
}

function parseYmd(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDisplayDate(locale, value) {
  const date = parseYmd(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function startOfGrid(monthDate) {
  const start = startOfMonth(monthDate);
  const day = start.getDay();
  return new Date(start.getTime() - day * DAY_MS);
}

function buildWeekdayLabels(locale) {
  const base = new Date(Date.UTC(2024, 0, 7));
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(base.getTime() + index * DAY_MS)));
}

function createButton(className, text, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  if (label) {
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  return button;
}

function dispatchValueChange(input) {
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeInputValue(input, value) {
  INPUT_VALUE_DESCRIPTOR.set.call(input, value);
}

function getNativeInputValue(input) {
  return INPUT_VALUE_DESCRIPTOR.get.call(input);
}

function attachLabelHandlers(input, trigger) {
  const labels = [];
  const explicitLabels = input.id ? Array.from(document.querySelectorAll(`label[for="${input.id}"]`)) : [];
  labels.push(...explicitLabels);
  const parentLabel = input.closest("label");
  if (parentLabel && !labels.includes(parentLabel)) {
    labels.push(parentLabel);
  }
  labels.forEach((label) => {
    label.addEventListener("click", (event) => {
      if (event.target === trigger || trigger.contains(event.target)) return;
      event.preventDefault();
      trigger.focus();
      trigger.click();
    });
  });
}

export function attachDatePicker(input, options = {}) {
  if (!(input instanceof HTMLInputElement)) return null;
  if (INSTANCE_MAP.has(input)) return INSTANCE_MAP.get(input);

  const getLocale = () => String(options.getLocale?.() || document.documentElement.lang || "en-US");
  const originalValue = getNativeInputValue(input);
  const triggerId = input.id ? `${input.id}Display` : "";
  const wrapper = document.createElement("div");
  wrapper.className = "app-date-picker";
  const trigger = createButton("app-input app-date-picker__trigger", "", "");
  if (triggerId) trigger.id = triggerId;
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  const triggerText = document.createElement("span");
  triggerText.className = "app-date-picker__trigger-text";
  const triggerIcon = document.createElement("span");
  triggerIcon.className = "app-date-picker__trigger-icon";
  triggerIcon.setAttribute("aria-hidden", "true");
  triggerIcon.textContent = "▾";
  trigger.append(triggerText, triggerIcon);

  const popover = document.createElement("div");
  popover.className = "app-date-picker__popover";
  popover.hidden = true;
  popover.innerHTML = `
    <div class="app-date-picker__header">
      <button type="button" class="app-date-picker__nav app-date-picker__nav--prev">‹</button>
      <div class="app-date-picker__title"></div>
      <button type="button" class="app-date-picker__nav app-date-picker__nav--next">›</button>
    </div>
    <div class="app-date-picker__weekdays"></div>
    <div class="app-date-picker__grid" role="grid"></div>
    <div class="app-date-picker__footer">
      <button type="button" class="app-date-picker__action" data-action="today"></button>
      <button type="button" class="app-date-picker__action" data-action="clear"></button>
    </div>
  `;
  wrapper.append(trigger);
  document.body.append(popover);
  input.insertAdjacentElement("afterend", wrapper);
  input.type = "hidden";
  input.dataset.customDatePicker = "true";
  attachLabelHandlers(input, trigger);

  const titleNode = popover.querySelector(".app-date-picker__title");
  const weekdaysNode = popover.querySelector(".app-date-picker__weekdays");
  const gridNode = popover.querySelector(".app-date-picker__grid");
  const prevButton = popover.querySelector(".app-date-picker__nav--prev");
  const nextButton = popover.querySelector(".app-date-picker__nav--next");
  const todayButton = popover.querySelector('[data-action="today"]');
  const clearButton = popover.querySelector('[data-action="clear"]');

  const state = {
    viewDate: parseYmd(originalValue) || new Date(),
    open: false,
  };

  function positionPopover() {
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = Math.min(320, viewportWidth - 32);

    popover.style.width = `${popoverWidth}px`;

    let left = rect.left;
    if (left + popoverWidth > viewportWidth - 16) {
      left = viewportWidth - popoverWidth - 16;
    }
    left = Math.max(16, left);

    const estimatedHeight = popover.offsetHeight || 320;
    const spaceBelow = viewportHeight - rect.bottom;
    const shouldOpenAbove = spaceBelow < estimatedHeight + 12 && rect.top > spaceBelow;
    const top = shouldOpenAbove
      ? Math.max(16, rect.top - estimatedHeight - 8)
      : Math.min(viewportHeight - estimatedHeight - 16, rect.bottom + 8);

    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(16, top)}px`;
  }

  function syncTrigger() {
    const locale = getLocale();
    const strings = getStrings(locale);
    const value = getNativeInputValue(input);
    const display = formatDisplayDate(locale, value);
    triggerText.textContent = display || strings.selectDate;
    trigger.classList.toggle("is-empty", !display);
    trigger.setAttribute("aria-label", display || strings.selectDate);
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  function open() {
    if (state.open) return;
    const selectedDate = parseYmd(getNativeInputValue(input));
    state.viewDate = selectedDate || new Date();
    renderCalendar();
    state.open = true;
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    positionPopover();
  }

  function setValue(nextValue) {
    const normalized = parseYmd(nextValue) ? nextValue : "";
    if (getNativeInputValue(input) === normalized) {
      syncTrigger();
      renderCalendar();
      return;
    }
    setNativeInputValue(input, normalized);
    syncTrigger();
    renderCalendar();
    if (state.open) positionPopover();
    dispatchValueChange(input);
  }

  function renderCalendar() {
    const locale = getLocale();
    const strings = getStrings(locale);
    const selected = parseYmd(getNativeInputValue(input));
    const today = formatYmd(new Date());
    const monthDate = startOfMonth(state.viewDate);
    const titleFormatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" });

    titleNode.textContent = titleFormatter.format(monthDate);
    prevButton.setAttribute("aria-label", strings.previousMonth);
    nextButton.setAttribute("aria-label", strings.nextMonth);
    todayButton.textContent = strings.today;
    clearButton.textContent = strings.clear;
    weekdaysNode.innerHTML = buildWeekdayLabels(locale).map((label) => `<span>${label}</span>`).join("");

    const gridStart = startOfGrid(monthDate);
    const selectedYmd = selected ? formatYmd(selected) : "";
    const buttons = [];
    for (let index = 0; index < 42; index += 1) {
      const current = new Date(gridStart.getTime() + index * DAY_MS);
      const ymd = formatYmd(current);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "app-date-picker__day";
      if (current.getMonth() !== monthDate.getMonth()) {
        button.classList.add("is-outside");
      }
      if (ymd === selectedYmd) {
        button.classList.add("is-selected");
        button.setAttribute("aria-pressed", "true");
      } else {
        button.setAttribute("aria-pressed", "false");
      }
      if (ymd === today) {
        button.classList.add("is-today");
      }
      button.dataset.value = ymd;
      button.textContent = String(current.getDate());
      buttons.push(button);
    }
    gridNode.replaceChildren(...buttons);
    if (state.open) {
      queueMicrotask(() => positionPopover());
    }
  }

  function handleDocumentPointer(event) {
    if (!state.open) return;
    if (wrapper.contains(event.target) || popover.contains(event.target) || input.contains(event.target)) return;
    close();
  }

  function handleDocumentKey(event) {
    if (event.key === "Escape") {
      close();
    }
  }

  function handleViewportChange() {
    if (state.open) positionPopover();
  }

  trigger.addEventListener("click", () => {
    if (state.open) {
      close();
    } else {
      open();
    }
  });

  prevButton.addEventListener("click", () => {
    state.viewDate = addMonths(state.viewDate, -1);
    renderCalendar();
  });

  nextButton.addEventListener("click", () => {
    state.viewDate = addMonths(state.viewDate, 1);
    renderCalendar();
  });

  todayButton.addEventListener("click", () => {
    const todayDate = new Date();
    state.viewDate = todayDate;
    setValue(formatYmd(todayDate));
    close();
  });

  clearButton.addEventListener("click", () => {
    setValue("");
    close();
  });

  gridNode.addEventListener("click", (event) => {
    const button = event.target.closest(".app-date-picker__day");
    if (!button) return;
    setValue(button.dataset.value || "");
    close();
  });

  window.addEventListener("gallery:language-changed", () => {
    syncTrigger();
    if (state.open) renderCalendar();
  });
  document.addEventListener("pointerdown", handleDocumentPointer);
  document.addEventListener("keydown", handleDocumentKey);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);

  Object.defineProperty(input, "value", {
    configurable: true,
    enumerable: true,
    get() {
      return getNativeInputValue(input);
    },
    set(nextValue) {
      setNativeInputValue(input, nextValue);
      syncTrigger();
      if (state.open) {
        const parsed = parseYmd(nextValue);
        if (parsed) {
          state.viewDate = parsed;
        }
        renderCalendar();
      }
    },
  });

  syncTrigger();

  const api = {
    input,
    refresh() {
      syncTrigger();
      if (state.open) renderCalendar();
    },
    destroy() {
      close();
      popover.remove();
      document.removeEventListener("pointerdown", handleDocumentPointer);
      document.removeEventListener("keydown", handleDocumentKey);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    },
  };

  INSTANCE_MAP.set(input, api);
  return api;
}
