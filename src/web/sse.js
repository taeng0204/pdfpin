// Live updates from the daemon.
export function connectEvents(docId, handlers, onState) {
  let es = null;
  let wasConnected = false;
  const open = () => {
    es = new EventSource(`/api/docs/${docId}/events`);
    onState('connecting');
    es.onopen = () => { onState('open'); if (wasConnected) handlers.resync?.(); wasConnected = true; };
    es.onerror = () => onState(es.readyState === EventSource.CLOSED ? 'error' : 'connecting');
    for (const name of ['annotation.added', 'annotation.updated', 'annotation.removed', 'annotations.cleared', 'summary.updated', 'focus', 'doc.reloaded', 'doc.removed', 'docs.changed', 'session.added', 'session.updated', 'session.removed', 'session.current']) {
      es.addEventListener(name, (e) => { try { handlers[name]?.(JSON.parse(e.data)); } catch (err) { console.error(name, err); } });
    }
  };
  open();
  return () => es?.close();
}
