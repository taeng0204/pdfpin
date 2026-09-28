// Live updates from the daemon.
export function connectEvents(docId, handlers, onState) {
  let es = null;
  let wasConnected = false;
  const open = () => {
    es = new EventSource(`/api/docs/${docId}/events`);
    onState('connecting');
    es.onopen = () => { onState('open'); if (wasConnected) handlers.resync?.(); wasConnected = true; };
    es.onerror = () => onState(es.readyState === EventSource.CLOSED ? 'error' : 'connecting');
    // Subscribe to exactly what the caller handles, so a new event never needs a second edit here.
    for (const name of Object.keys(handlers)) {
      if (name === 'resync') continue;
      es.addEventListener(name, (e) => { try { handlers[name](JSON.parse(e.data)); } catch (err) { console.error(name, err); } });
    }
  };
  open();
  return () => es?.close();
}
