// Shared state - initialized by router
let _state = null;
function getState() {
    if (!_state) throw new Error('Shared state not initialized');
    return _state;
}
function setState(state) {
    _state = state;
}
module.exports = { getState, setState };
