"use client";

/* R2 images are served through the public notebook API; the bucket stays private. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

type NoteColor = "yellow" | "coral" | "sage" | "lavender" | "sky";
type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
};
type Note = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  isPinned: boolean;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
};
type Filter = "all" | "pinned" | "archived";
type SaveState = "saved" | "unsaved" | "saving" | "offline" | "error" | "conflict";

class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public latest?: Note,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new RequestError(
      response.status,
      typeof payload.error === "string" ? payload.error : "Something went wrong.",
      typeof payload.code === "string" ? payload.code : undefined,
      payload.latest as Note | undefined,
    );
  }
  return payload as T;
}

function relativeTime(iso: string) {
  const elapsed = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
}

function noteTitle(note: Note) {
  return note.title.trim() || note.content.trim().split("\n")[0] || "Untitled note";
}

function sameEditableNote(a: Note, b: Note) {
  return a.title === b.title
    && a.content === b.content
    && a.color === b.color
    && a.isPinned === b.isPinned
    && a.isArchived === b.isArchived;
}

function subscribeToConnection(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function readConnection() {
  return navigator.onLine;
}

function BrandMark({ size = "medium" }: { size?: "small" | "medium" | "large" }) {
  const pixels = size === "small" ? 48 : size === "large" ? 144 : 80;
  return (
    <img
      className={`brand-mark brand-mark--${size}`}
      src={size === "large" ? "/icon-512.png?v=2" : "/icon-192.png?v=2"}
      width={pixels}
      height={pixels}
      alt=""
      aria-hidden="true"
      decoding="async"
    />
  );
}

function LoadingCards() {
  return (
    <div className="loading-stack" aria-label="Loading notes" aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div className="note-skeleton" key={item}>
          <span className="skeleton-line skeleton-line--short" />
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-line--mid" />
        </div>
      ))}
    </div>
  );
}

function NoteCard({ note, active, onOpen }: { note: Note; active: boolean; onOpen: () => void }) {
  return (
    <button className={`note-card note-card--${note.color}${active ? " is-active" : ""}`} onClick={onOpen} aria-current={active ? "page" : undefined}>
      <span className="note-card__topline">
        <span className="note-card__title">{noteTitle(note)}</span>
        {note.isPinned ? <span className="pin-badge" aria-label="Pinned">◆</span> : null}
      </span>
      {note.content.trim() ? <span className="note-card__excerpt">{note.content}</span> : <span className="note-card__excerpt note-card__excerpt--empty">A fresh page</span>}
      {note.attachments.length ? (
        <span className={`note-card__photos note-card__photos--${Math.min(3, note.attachments.length)}`}>
          {note.attachments.slice(0, 3).map((attachment) => (
            <img key={attachment.id} src={attachment.url} alt="" loading="lazy" />
          ))}
          {note.attachments.length > 3 ? <span className="photo-count">+{note.attachments.length - 3}</span> : null}
        </span>
      ) : null}
      <span className="note-card__meta">
        <span>{relativeTime(note.updatedAt)}</span>
        {note.isArchived ? <span>Archived</span> : note.attachments.length ? <span>{note.attachments.length} photo{note.attachments.length === 1 ? "" : "s"}</span> : <span>Note</span>}
      </span>
    </button>
  );
}

export function PikaNoteApp() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const online = useSyncExternalStore(subscribeToConnection, readConnection, () => true);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [viewer, setViewer] = useState<Attachment | null>(null);
  const [conflict, setConflict] = useState<{ local: Note; cloud: Note } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<Note | null>(null);
  const dirtyRef = useRef(false);
  const versionsRef = useRef(new Map<string, number>());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const notesRef = useRef<Note[]>([]);
  const selectedIdRef = useRef<string | null>(null);

  const selectDraft = useCallback((id: string, suppliedNote?: Note) => {
    const selected = suppliedNote ?? notesRef.current.find((note) => note.id === id);
    if (!selected) return;
    const next = { ...selected, attachments: [...selected.attachments] };
    selectedIdRef.current = id;
    setSelectedId(id);
    setDraft(next);
    draftRef.current = next;
    dirtyRef.current = false;
    setDirty(false);
    setSaveState("saved");
    setConflict(null);
  }, []);

  const clearDraft = useCallback(() => {
    selectedIdRef.current = null;
    setSelectedId(null);
    setDraft(null);
    draftRef.current = null;
    dirtyRef.current = false;
    setDirty(false);
    setSaveState("saved");
    setConflict(null);
  }, []);

  // The save queue deliberately has stable identity so edits cannot overtake each other.
  const saveDraft = useCallback((snapshot: Note) => {
    const run = async () => {
      if (!navigator.onLine) {
        setSaveState("offline");
        return;
      }
      setSaveState("saving");
      const expectedVersion = versionsRef.current.get(snapshot.id) ?? snapshot.version;
      try {
        const data = await requestJson<{ note: Note }>(`/api/notes/${snapshot.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: snapshot.title,
            content: snapshot.content,
            color: snapshot.color,
            isPinned: snapshot.isPinned,
            isArchived: snapshot.isArchived,
            expectedVersion,
          }),
        });
        versionsRef.current.set(snapshot.id, data.note.version);
        setNotes((current) => {
          const next = current.map((note) => note.id === data.note.id ? data.note : note);
          notesRef.current = next;
          return next;
        });
        const latestDraft = draftRef.current;
        if (latestDraft?.id === snapshot.id) {
          const unchanged = sameEditableNote(latestDraft, snapshot);
          const merged = unchanged
            ? data.note
            : { ...latestDraft, version: data.note.version, updatedAt: data.note.updatedAt };
          setDraft(merged);
          draftRef.current = merged;
          dirtyRef.current = !unchanged;
          setDirty(!unchanged);
          setSaveState(unchanged ? "saved" : "unsaved");
        }
      } catch (error) {
        if (error instanceof RequestError && error.code === "VERSION_CONFLICT" && error.latest) {
          const local = draftRef.current?.id === snapshot.id ? draftRef.current : snapshot;
          setConflict({ local, cloud: error.latest });
          setSaveState("conflict");
          return;
        }
        setSaveState(navigator.onLine ? "error" : "offline");
        setToast(error instanceof Error ? error.message : "This note couldn’t save.");
      }
    };
    saveQueueRef.current = saveQueueRef.current.then(run, run);
    return saveQueueRef.current;
  }, []);

  const loadNotes = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError("");
    try {
      const data = await requestJson<{ notes: Note[] }>("/api/notes?archived=all", { cache: "no-store" });
      notesRef.current = data.notes;
      setNotes(data.notes);
      const currentId = selectedIdRef.current;
      for (const note of data.notes) {
        // A refresh must not advance an unsaved draft's version past another
        // visitor's edit, otherwise the next save would silently overwrite it.
        if (note.id !== currentId || !dirtyRef.current) versionsRef.current.set(note.id, note.version);
      }
      const hashMatch = window.location.hash.match(/^#note=(.+)$/);
      const requestedId = currentId ?? (hashMatch ? decodeURIComponent(hashMatch[1]) : null);
      const refreshed = requestedId ? data.notes.find((note) => note.id === requestedId) : undefined;
      if (refreshed && (!currentId || !dirtyRef.current)) selectDraft(refreshed.id, refreshed);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Notes couldn’t load.");
    } finally {
      setLoading(false);
    }
  }, [selectDraft]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadNotes(), 0);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);

    const handleOnline = () => {
      void loadNotes(true);
      if (dirtyRef.current && draftRef.current) void saveDraft(draftRef.current);
    };
    const handleOffline = () => {
      if (dirtyRef.current) setSaveState("offline");
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadNotes(true);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadNotes, saveDraft]);

  useEffect(() => {
    const handlePopState = () => {
      const match = window.location.hash.match(/^#note=(.+)$/);
      if (match) selectDraft(decodeURIComponent(match[1]));
      else clearDraft();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clearDraft, selectDraft]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!dirty || !draft || !online || conflict) return;
    const timer = window.setTimeout(() => void saveDraft({ ...draft, attachments: [...draft.attachments] }), 700);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, draft, online, saveDraft]);

  const updateDraft = useCallback((changes: Partial<Note>) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...changes };
      draftRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    setDirty(true);
    setSaveState(online ? "unsaved" : "offline");
  }, [online]);

  const openNote = useCallback((id: string, suppliedNote?: Note) => {
    if (dirtyRef.current && draftRef.current) void saveDraft({ ...draftRef.current });
    selectDraft(id, suppliedNote);
    if (window.matchMedia("(max-width: 799px)").matches && window.location.hash !== `#note=${encodeURIComponent(id)}`) {
      window.history.pushState({ noteId: id }, "", `#note=${encodeURIComponent(id)}`);
    }
  }, [saveDraft, selectDraft]);

  const closeEditor = useCallback(() => {
    if (dirtyRef.current && draftRef.current) void saveDraft({ ...draftRef.current });
    if (window.location.hash.startsWith("#note=")) window.history.back();
    else clearDraft();
  }, [clearDraft, saveDraft]);

  const createNote = useCallback(async (withPhoto = false) => {
    if (creating) return;
    setCreating(true);
    try {
      const colors: NoteColor[] = ["yellow", "sage", "coral", "lavender", "sky"];
      const data = await requestJson<{ note: Note }>("/api/notes", {
        method: "POST",
        body: JSON.stringify({ title: "", content: "", color: colors[notes.length % colors.length] }),
      });
      versionsRef.current.set(data.note.id, data.note.version);
      setNotes((current) => {
        const next = [data.note, ...current];
        notesRef.current = next;
        return next;
      });
      setFilter("all");
      openNote(data.note.id, data.note);
      if (withPhoto) window.setTimeout(() => fileInputRef.current?.click(), 180);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "A new note couldn’t be created.");
    } finally {
      setCreating(false);
    }
  }, [creating, notes.length, openNote]);

  const deleteNote = useCallback(async () => {
    if (!draft) return;
    try {
      await requestJson<{ deleted: boolean }>(`/api/notes/${draft.id}`, { method: "DELETE" });
      versionsRef.current.delete(draft.id);
      setNotes((current) => current.filter((note) => note.id !== draft.id));
      setDeleteOpen(false);
      setToast("Note deleted");
      closeEditor();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The note couldn’t be deleted.");
    }
  }, [closeEditor, draft]);

  const uploadImages = useCallback(async (files: FileList | null) => {
    if (!files?.length || !draftRef.current || uploading) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        setToast(`${file.name} is larger than 10 MB.`);
        continue;
      }
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
        setToast(`${file.name} isn’t a supported image.`);
        continue;
      }
      try {
        const form = new FormData();
        form.append("image", file);
        const activeDraft = draftRef.current;
        if (!activeDraft) break;
        const currentId = activeDraft.id;
        const data = await requestJson<{ attachment: Attachment }>(`/api/notes/${currentId}/images`, { method: "POST", body: form });
        const current: Note | null = draftRef.current;
        if (!current || current.id !== currentId) continue;
        const updated: Note = { ...current, attachments: [data.attachment, ...current.attachments], updatedAt: new Date().toISOString() };
        draftRef.current = updated;
        setDraft(updated);
        setNotes((all) => all.map((note) => note.id === currentId ? { ...note, attachments: updated.attachments, updatedAt: updated.updatedAt } : note));
      } catch (error) {
        setToast(error instanceof Error ? error.message : `${file.name} couldn’t upload.`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
  }, [uploading]);

  const removeImage = useCallback(async (attachment: Attachment) => {
    if (!window.confirm(`Remove ${attachment.filename || "this image"} from the note?`)) return;
    try {
      await requestJson<{ deleted: boolean }>(`/api/images/${attachment.id}`, { method: "DELETE" });
      const current = draftRef.current;
      if (!current) return;
      const updated = { ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id) };
      draftRef.current = updated;
      setDraft(updated);
      setNotes((all) => all.map((note) => note.id === current.id ? { ...note, attachments: updated.attachments } : note));
      if (viewer?.id === attachment.id) setViewer(null);
      setToast("Photo removed");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The photo couldn’t be removed.");
    }
  }, [viewer]);

  useEffect(() => {
    if (!deleteOpen && !viewer) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDeleteOpen(false);
      setViewer(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [deleteOpen, viewer]);

  const visibleNotes = useMemo(() => {
    const filtered = notes.filter((note) => {
      if (filter === "archived" && !note.isArchived) return false;
      if (filter !== "archived" && note.isArchived) return false;
      if (filter === "pinned" && !note.isPinned) return false;
      if (!deferredSearch) return true;
      return `${note.title}\n${note.content}`.toLowerCase().includes(deferredSearch);
    });
    return filtered.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [deferredSearch, filter, notes]);

  const saveLabel = !online || saveState === "offline"
    ? "Offline — waiting"
    : saveState === "saving"
      ? "Saving…"
      : saveState === "unsaved"
        ? "Unsaved"
        : saveState === "error"
          ? "Couldn’t save"
          : saveState === "conflict"
            ? "Newer copy found"
            : "Saved";

  return (
    <main className={`app-shell${selectedId ? " has-editor" : ""}`}>
      <aside className="note-browser" aria-label="Notes">
        <header className="browser-header">
          <div className="brand-lockup">
            <BrandMark size="small" />
            <div><strong>Pika Note</strong><span>Keep a thought. Find it fast.</span></div>
          </div>
          <span className="sharing-pill"><span aria-hidden="true">●</span> Public</span>
        </header>

        <div className="status-banner">Shared notebook — anyone with the link can view, edit, and delete notes and photos.</div>
        {!online ? <div className="status-banner status-banner--offline">You’re offline. Open notes stay here; changes sync when you reconnect.</div> : null}
        {loadError ? <div className="status-banner status-banner--error">{loadError}<button onClick={() => void loadNotes()}>Retry</button></div> : null}

        <div className="search-wrap">
          <label className="sr-only" htmlFor="note-search">Find a thought</label>
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input id="note-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a thought…" autoComplete="off" />
          {search ? <button className="clear-search" onClick={() => setSearch("")} aria-label="Clear search">×</button> : null}
        </div>

        <nav className="filter-row" aria-label="Note filters">
          {(["all", "pinned", "archived"] as Filter[]).map((item) => (
            <button key={item} className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)} aria-pressed={filter === item}>
              {item === "all" ? "All notes" : item === "pinned" ? "Pinned" : "Archived"}
            </button>
          ))}
        </nav>

        <section className="notes-list" aria-live="polite">
          {loading ? <LoadingCards /> : visibleNotes.length ? visibleNotes.map((note) => (
            <NoteCard key={note.id} note={note} active={selectedId === note.id} onOpen={() => openNote(note.id)} />
          )) : (
            <div className="empty-list">
              <BrandMark />
              <h2>{search ? `No notes match “${search}”` : filter === "archived" ? "Nothing archived yet." : filter === "pinned" ? "No pinned notes yet." : "A quiet page, ready when you are."}</h2>
              <p>{search ? "Try another word or clear the search." : filter === "archived" ? "Notes you archive will wait here." : "Keep a thought, a list, or a photo close."}</p>
              {search ? <button className="secondary-button" onClick={() => setSearch("")}>Clear search</button> : filter === "all" ? (
                <div className="empty-actions">
                  <button className="primary-button" onClick={() => void createNote(false)}>Write a note</button>
                  <button className="secondary-button" onClick={() => void createNote(true)}>Add a photo</button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <footer className="browser-footer">
          <span>{notes.filter((note) => !note.isArchived).length} note{notes.filter((note) => !note.isArchived).length === 1 ? "" : "s"}</span>
          <span className="sync-copy"><span className={`sync-dot${online ? "" : " is-offline"}`} />{online ? "Cloud synced" : "Waiting for signal"}</span>
        </footer>

        <button className="new-note-fab" onClick={() => void createNote(false)} disabled={creating} aria-label="Create a new note">
          <span aria-hidden="true">+</span><span>{creating ? "Opening…" : "New note"}</span>
        </button>
      </aside>

      <section className="editor-stage" aria-label="Note editor">
        {draft ? (
          <article className={`note-editor note-editor--${draft.color}`}>
            <header className="editor-header">
              <button className="icon-button back-button" onClick={closeEditor} aria-label="Back to notes"><span aria-hidden="true">←</span></button>
              <div className={`save-state save-state--${saveState}`} role="status" aria-live="polite"><span />{saveLabel}</div>
              <div className="editor-header__actions">
                <button className={`icon-button${draft.isPinned ? " is-active" : ""}`} onClick={() => updateDraft({ isPinned: !draft.isPinned })} aria-label={draft.isPinned ? "Unpin note" : "Pin note"} title={draft.isPinned ? "Unpin" : "Pin"}><span aria-hidden="true">◆</span></button>
                <button className="icon-button" onClick={() => { updateDraft({ isArchived: !draft.isArchived }); window.setTimeout(closeEditor, 120); }} aria-label={draft.isArchived ? "Restore note" : "Archive note"} title={draft.isArchived ? "Restore" : "Archive"}><span aria-hidden="true">↓</span></button>
                <button className="icon-button icon-button--danger" onClick={() => setDeleteOpen(true)} aria-label="Delete note" title="Delete"><span aria-hidden="true">×</span></button>
              </div>
            </header>

            {conflict ? (
              <section className="conflict-card" role="alert">
                <div><strong>This note changed on another device.</strong><span>Choose which copy to keep.</span></div>
                <div>
                  <button className="secondary-button" onClick={() => {
                    versionsRef.current.set(conflict.cloud.id, conflict.cloud.version);
                    setNotes((all) => all.map((note) => note.id === conflict.cloud.id ? conflict.cloud : note));
                    setDraft(conflict.cloud);
                    draftRef.current = conflict.cloud;
                    dirtyRef.current = false;
                    setDirty(false);
                    setConflict(null);
                    setSaveState("saved");
                  }}>Use cloud copy</button>
                  <button className="primary-button" onClick={() => {
                    versionsRef.current.set(conflict.local.id, conflict.cloud.version);
                    const local = { ...conflict.local, version: conflict.cloud.version };
                    setDraft(local);
                    draftRef.current = local;
                    dirtyRef.current = true;
                    setDirty(true);
                    setConflict(null);
                    void saveDraft(local);
                  }}>Keep my changes</button>
                </div>
              </section>
            ) : null}

            <div className="editor-scroll">
              <div className="paper-sheet">
                <label className="sr-only" htmlFor="note-title">Note title</label>
                <input id="note-title" className="title-input" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} onBlur={() => dirtyRef.current && draftRef.current ? void saveDraft({ ...draftRef.current }) : undefined} placeholder="Give this thought a name" maxLength={200} />
                <div className="paper-rule" />
                <label className="sr-only" htmlFor="note-content">Note</label>
                <textarea id="note-content" className="content-input" value={draft.content} onChange={(event) => updateDraft({ content: event.target.value })} onBlur={() => dirtyRef.current && draftRef.current ? void saveDraft({ ...draftRef.current }) : undefined} placeholder="Start typing…" maxLength={100000} />

                {draft.attachments.length || uploading ? (
                  <section className="attachment-section" aria-label="Photos">
                    <div className="section-label"><span>Photos</span><span>{draft.attachments.length}/12</span></div>
                    <div className="attachment-grid">
                      {uploading ? <div className="upload-tile" role="status"><span className="upload-spinner" /><span>Adding photo…</span></div> : null}
                      {draft.attachments.map((attachment) => (
                        <figure className="attachment-tile" key={attachment.id}>
                          <button className="attachment-open" onClick={() => setViewer(attachment)} aria-label={`Open ${attachment.filename}`}>
                            <img src={attachment.url} alt={attachment.filename} loading="lazy" />
                          </button>
                          <button className="attachment-remove" onClick={() => void removeImage(attachment)} aria-label={`Remove ${attachment.filename}`}>×</button>
                        </figure>
                      ))}
                    </div>
                  </section>
                ) : null}

                <p className="edited-time">Last edited {relativeTime(draft.updatedAt)}</p>
              </div>
            </div>

            <footer className="editor-toolbar">
              <input ref={fileInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => void uploadImages(event.target.files)} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading || draft.attachments.length >= 12}><span aria-hidden="true">▧</span><span>Photo</span></button>
              <div className="color-picker" aria-label="Note color">
                {(["yellow", "coral", "sage", "lavender", "sky"] as NoteColor[]).map((color) => (
                  <button key={color} className={`color-dot color-dot--${color}${draft.color === color ? " is-active" : ""}`} onClick={() => updateDraft({ color })} aria-label={`Use ${color} note color`} aria-pressed={draft.color === color} />
                ))}
              </div>
              <button onClick={() => { updateDraft({ isArchived: !draft.isArchived }); window.setTimeout(closeEditor, 120); }}><span aria-hidden="true">↓</span><span>{draft.isArchived ? "Restore" : "Archive"}</span></button>
            </footer>
          </article>
        ) : (
          <div className="editor-welcome">
            <BrandMark size="large" />
            <p className="eyebrow">Pika Note</p>
            <h1>A little space for what matters.</h1>
            <p>Pick a note from the left, or start a fresh one. Your words and photos save to the cloud automatically.</p>
            <button className="primary-button" onClick={() => void createNote(false)}>Write a note</button>
          </div>
        )}
      </section>

      {deleteOpen && draft ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteOpen(false); }}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <span className="dialog-mark" aria-hidden="true">×</span>
            <h2 id="delete-title">Delete this note?</h2>
            <p>“{noteTitle(draft)}” and all its photos will be permanently removed for everyone.</p>
            <div><button className="secondary-button" autoFocus onClick={() => setDeleteOpen(false)}>Keep note</button><button className="danger-button" onClick={() => void deleteNote()}>Delete forever</button></div>
          </section>
        </div>
      ) : null}

      {viewer ? (
        <div className="image-viewer" role="dialog" aria-modal="true" aria-label={`Viewing ${viewer.filename}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setViewer(null); }}>
          <div className="viewer-bar"><span>{viewer.filename}</span><div><button onClick={() => void removeImage(viewer)}>Remove</button><button className="viewer-close" onClick={() => setViewer(null)} aria-label="Close image">×</button></div></div>
          <img src={viewer.url} alt={viewer.filename} />
        </div>
      ) : null}

      <div className={`toast${toast ? " is-visible" : ""}`} role="status" aria-live="polite">{toast}</div>
    </main>
  );
}
