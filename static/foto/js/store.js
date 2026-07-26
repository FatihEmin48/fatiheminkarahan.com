// Düzenleme durumu + geri/ileri al geçmişi.
// Kaydırıcılar sürüklenirken her kareyi geçmişe yazmamak için begin()/commit() ikilisi var.

const LIMIT = 80;

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export class Store {
  constructor(initial) {
    this.state = initial;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.listeners = new Set();
  }

  get() {
    return this.state;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    for (const fn of this.listeners) fn(this.state, reason);
  }

  /** Düzenleme öncesi anlık görüntüyü sakla. */
  begin() {
    if (!this.pending) this.pending = clone(this.state);
  }

  /** Değişikliği geçmişe yaz. */
  commit(label = '') {
    if (!this.pending) return;
    const before = this.pending;
    this.pending = null;
    if (JSON.stringify(before) === JSON.stringify(this.state)) return;
    this.undoStack.push({ snapshot: before, label });
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit('history');
  }

  /** begin + değiştir + commit tek adımda. */
  transact(label, fn) {
    this.begin();
    fn(this.state);
    this.commit(label);
    this.emit('change');
  }

  touch(reason = 'change') {
    this.emit(reason);
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.undoStack.length) return false;
    const entry = this.undoStack.pop();
    this.redoStack.push({ snapshot: clone(this.state), label: entry.label });
    this.state = entry.snapshot;
    this.pending = null;
    this.emit('undo');
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    const entry = this.redoStack.pop();
    this.undoStack.push({ snapshot: clone(this.state), label: entry.label });
    this.state = entry.snapshot;
    this.pending = null;
    this.emit('redo');
    return true;
  }

  replace(newState, label = 'değişiklik') {
    this.begin();
    this.state = newState;
    this.commit(label);
    this.emit('change');
  }

  clearHistory() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
    this.emit('history');
  }
}

export { clone };
