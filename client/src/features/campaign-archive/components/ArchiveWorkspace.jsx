import { useEffect, useMemo, useRef, useState } from 'react';
import ArchiveTree from './ArchiveTree.jsx';
import ArchiveEntryList from './ArchiveEntryList.jsx';
import ArchiveEntryEditor from './ArchiveEntryEditor.jsx';
import ArchiveEntryViewer from './ArchiveEntryViewer.jsx';
import { useCampaignArchive } from '../hooks/useCampaignArchive.js';

const paneButton = (active) =>
  `flex-1 border-b-2 px-2 py-2 font-display text-xs uppercase tracking-wider ${
    active ? 'border-gold text-gold' : 'border-transparent text-bone/50'
  }`;

// El área de trabajo del Archivo (árbol de secciones, entradas y editor o
// visor), sin cabecera propia: se embebe en el paso «Lore y trama» del
// taller del DM y en las Crónicas de campaña del jugador.
export default function ArchiveWorkspace({ campaignId, canEdit, initialData = null, onData = null }) {
  const archive = useCampaignArchive(campaignId, { initialData, onData });
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mobilePane, setMobilePane] = useState('secciones');
  const initialSelectionDone = useRef(false);

  const sections = useMemo(() => {
    const rows = archive.nodes.filter((node) => node.type === 'seccion' || node.kind === 'seccion');
    const byId = new Map(rows.map((section) => [section.id, section]));
    const optionLabel = (section) => {
      const parts = [section.title];
      const seen = new Set([section.id]);
      let parent = byId.get(section.parentId);
      while (parent && !seen.has(parent.id)) {
        seen.add(parent.id);
        parts.unshift(parent.title);
        parent = byId.get(parent.parentId);
      }
      return parts.join(' › ');
    };
    return rows.map((section) => ({ ...section, optionLabel: optionLabel(section) }));
  }, [archive.nodes]);
  const entries = useMemo(
    () => archive.nodes.filter((node) => node.type === 'entrada' || node.kind === 'entrada'),
    [archive.nodes]
  );

  useEffect(() => {
    if (archive.loading || initialSelectionDone.current) return;
    initialSelectionDone.current = true;
    const firstRoot = sections
      .filter((section) => section.parentId == null)
      .sort((a, b) => a.position - b.position || a.id - b.id)[0];
    if (firstRoot) setSelectedSectionId(firstRoot.id);
  }, [archive.loading, sections]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      archive
        .search(query)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [archive.search, searchQuery]);

  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? null;
  const visibleEntries = searchQuery.trim()
    ? searchResults
    : entries.filter((entry) => entry.parentId === selectedSectionId);
  const selectedEntry =
    entries.find((entry) => entry.id === selectedEntryId) ??
    searchResults.find(
      (entry) => entry.id === selectedEntryId && (entry.type === 'entrada' || entry.kind === 'entrada')
    ) ??
    null;

  const safe = (promise) => promise.catch(() => null);

  async function createSection(parentId) {
    const title = window.prompt(parentId == null ? 'Nombre de la nueva sección' : 'Nombre de la nueva subsección');
    if (!title?.trim()) return;
    const result = await safe(
      archive.createNode({ parentId, kind: 'seccion', title: title.trim(), summary: '' })
    );
    if (result?.node) {
      setSelectedSectionId(Number(result.node.id));
      setSelectedEntryId(null);
      setSearchQuery('');
      setMobilePane('secciones');
    }
  }

  async function renameSection(section) {
    const title = window.prompt('Nuevo nombre de la sección', section.title);
    if (!title?.trim() || title.trim() === section.title) return;
    await safe(archive.patchNode(section.id, { title: title.trim() }));
  }

  async function changeSectionIcon(section, icon) {
    await safe(archive.patchNode(section.id, { icon: icon || null }));
  }

  async function deleteSection(section) {
    if (
      !window.confirm(
        `¿Borrar la sección «${section.title}»? También se borrarán sus subsecciones, entradas y bloques.`
      )
    ) {
      return;
    }
    const parentId = section.parentId;
    const result = await safe(archive.deleteNode(section.id));
    if (result !== null) {
      setSelectedSectionId(parentId);
      setSelectedEntryId(null);
    }
  }

  async function createEntry() {
    const title = window.prompt('Título de la nueva entrada', 'Nueva entrada');
    if (!title?.trim()) return;
    const result = await safe(
      archive.createNode({
        parentId: selectedSectionId,
        kind: 'entrada',
        title: title.trim(),
        summary: '',
        visibility: 'private',
      })
    );
    if (result?.node) {
      setSelectedEntryId(Number(result.node.id));
      setSearchQuery('');
      setMobilePane('editor');
    }
  }

  function selectSearchResult(node) {
    if (node.type === 'seccion' || node.kind === 'seccion') {
      setSelectedSectionId(node.id);
      setSelectedEntryId(null);
      setSearchQuery('');
      setMobilePane('entradas');
      return;
    }
    setSelectedSectionId(node.parentId);
    setSelectedEntryId(node.id);
    setMobilePane('editor');
  }

  function navigateToReference(entry) {
    if (!entry) return;
    setSelectedSectionId(entry.parentId);
    setSelectedEntryId(entry.id);
    setSearchQuery('');
    setMobilePane('editor');
  }

  async function patchSelectedEntry(body) {
    const result = await safe(archive.patchNode(selectedEntryId, body));
    if (result !== null && Object.hasOwn(body, 'parentId')) setSelectedSectionId(body.parentId);
    return result;
  }

  async function deleteSelectedEntry() {
    const result = await safe(archive.deleteNode(selectedEntryId));
    if (result !== null) {
      setSelectedEntryId(null);
      setMobilePane('entradas');
    }
    return result;
  }

  async function moveNodeWithinKind(nodeId, direction) {
    const node = archive.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return null;
    const siblings = archive.nodes
      .filter((candidate) => candidate.parentId === node.parentId)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const currentIndex = siblings.findIndex((candidate) => candidate.id === nodeId);
    const step = direction === 'up' ? -1 : 1;
    let targetIndex = currentIndex + step;
    while (targetIndex >= 0 && targetIndex < siblings.length && siblings[targetIndex].type !== node.type) {
      targetIndex += step;
    }
    if (targetIndex < 0 || targetIndex >= siblings.length) return null;
    const moves = Math.abs(targetIndex - currentIndex);
    let result = null;
    for (let index = 0; index < moves; index += 1) {
      result = await archive.moveNode(nodeId, { direction });
    }
    return result;
  }

  if (archive.loading) {
    return <div className="p-6 text-bone/55">Abriendo el Archivo de campaña…</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gold/15 bg-night-900/60 px-3 py-2">
        <label className="relative block min-w-0 flex-1 sm:max-w-72">
          <span className="sr-only">Buscar en el Archivo</span>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar títulos, resúmenes o bloques…"
            className="w-full rounded-sm border border-gold/20 bg-night-950 py-1.5 pl-3 pr-9 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-bone/40 hover:text-bone"
            >
              ×
            </button>
          )}
        </label>
        {archive.error && <p className="text-sm text-blood">{archive.error}</p>}
      </div>

      <div className="flex border-b border-gold/15 bg-night-900 lg:hidden">
        <button type="button" onClick={() => setMobilePane('secciones')} className={paneButton(mobilePane === 'secciones')}>
          Secciones
        </button>
        <button type="button" onClick={() => setMobilePane('entradas')} className={paneButton(mobilePane === 'entradas')}>
          Entradas
        </button>
        <button type="button" onClick={() => setMobilePane('editor')} className={paneButton(mobilePane === 'editor')}>
          {canEdit ? 'Editar' : 'Leer'}
        </button>
      </div>

      <div className="h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[240px_300px_minmax(0,1fr)]">
        <div className={`${mobilePane === 'secciones' ? 'block h-full' : 'hidden'} min-h-0 min-w-0 overflow-hidden lg:block lg:h-full`}>
          <ArchiveTree
            sections={sections}
            entries={entries}
            selectedId={selectedSectionId}
            busy={archive.busy}
            onSelect={(sectionId) => {
              setSelectedSectionId(sectionId);
              setSelectedEntryId(null);
              setSearchQuery('');
              setMobilePane('entradas');
            }}
            onCreate={createSection}
            onRename={renameSection}
            onDelete={deleteSection}
            onMove={(nodeId, direction) => safe(moveNodeWithinKind(nodeId, direction))}
            onChangeParent={(nodeId, parentId) => safe(archive.patchNode(nodeId, { parentId }))}
            onChangeIcon={changeSectionIcon}
            canEdit={canEdit}
          />
        </div>

        <div className={`${mobilePane === 'entradas' ? 'block h-full' : 'hidden'} min-h-0 min-w-0 overflow-hidden lg:block lg:h-full`}>
          <ArchiveEntryList
            entries={visibleEntries}
            selectedEntryId={selectedEntryId}
            selectedSection={selectedSection}
            searchQuery={searchQuery}
            searchLoading={searchLoading}
            busy={archive.busy}
            onCreate={createEntry}
            onSelect={(node) => {
              selectSearchResult(node);
              if (!searchQuery.trim()) setMobilePane('editor');
            }}
            onMove={(nodeId, direction) => safe(moveNodeWithinKind(nodeId, direction))}
            canEdit={canEdit}
          />
        </div>

        <div className={`${mobilePane === 'editor' ? 'block h-full' : 'hidden'} min-h-0 min-w-0 overflow-hidden lg:block lg:h-full`}>
          {canEdit ? (
            <ArchiveEntryEditor
              entry={selectedEntry}
              sections={sections}
              busy={archive.busy}
              privateImageUrl={archive.privateImageUrl}
              onPatchEntry={patchSelectedEntry}
              onDeleteEntry={deleteSelectedEntry}
              onCreateBlock={(body) => safe(archive.createBlock(selectedEntryId, body))}
              onPatchBlock={(blockId, body) => safe(archive.patchBlock(blockId, body))}
              onDeleteBlock={(blockId) => safe(archive.deleteBlock(blockId))}
              onMoveBlock={(blockId, body) => safe(archive.moveBlock(blockId, body))}
              onUploadImage={(blockId, file) => safe(archive.uploadBlockImage(blockId, file))}
              referenceEntries={entries}
              onNavigateReference={navigateToReference}
            />
          ) : (
            <ArchiveEntryViewer
              entry={selectedEntry}
              entries={entries}
              privateImageUrl={archive.privateImageUrl}
              onNavigateReference={navigateToReference}
            />
          )}
        </div>
      </div>
    </div>
  );
}
