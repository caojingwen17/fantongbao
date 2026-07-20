function createStepItem(text = "") {
  return {
    id: `step_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    text: String(text || ""),
  };
}

function normalizeStepItems(steps) {
  if (!Array.isArray(steps) || !steps.length) return [createStepItem()];
  return steps.map((s) => {
    if (s && typeof s === "object") {
      const text = s.text != null ? String(s.text) : String(s.name || "");
      return { id: s.id || createStepItem(text).id, text };
    }
    return createStepItem(s);
  });
}

function getStepTexts(items) {
  return (items || []).map((item) => (item && item.text != null ? String(item.text) : ""));
}

function reorderStepItems(items, fromIndex, toIndex) {
  const next = [...(items || [])];
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length) {
    return next;
  }
  if (fromIndex === toIndex) return next;
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function calcDragTargetIndex(rects, clientY, fallbackIndex = 0) {
  if (!Array.isArray(rects) || !rects.length) return fallbackIndex;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (!rect) continue;
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) return i;
  }
  return rects.length - 1;
}

module.exports = {
  createStepItem,
  normalizeStepItems,
  getStepTexts,
  reorderStepItems,
  calcDragTargetIndex,
};
