import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../api.js';
import ArchiveTree from '../components/ArchiveTree.jsx';
import ArchiveEntryList from '../components/ArchiveEntryList.jsx';
import ArchiveEntryEditor from '../components/ArchiveEntryEditor.jsx';
import { useCampaignArchive } from '../hooks/useCampaignArchive.js';

const paneButton = (active) =>
  `flex-1 border-b-2 px-2 py-2 font-display text-xs uppercase tracking-wider ${
    active ? 'border-gold text-gold' : 'border-transparent text-bone/50'
  }`;

export default function CampaignArchivePage() {
  const { id } = useParams();
  const archive = useCampaignArchive(id);
  const [campaign, setCampaign] = useState(null);
  const [campaignError, setCampaignError] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mobilePane, setMobilePane] = useState('secciones');
  const initialSelectionDone = useRef(false);

  useEffect(() => {
    api(`/campaigns/${id}`)
      .then(({ campaign: loaded }) => setCampaign(loaded))
      .catch((error) => setCampaignError(error.message));
  }, [id]);

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
    searchResults.find((entry) => entry.id === selectedEntryId && (entry.type === 'entrada' || entry.kind === 'entrada')) ??
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
      archive.createNode({ parentId: selectedSectionId, kind: 'entrada', title: title.trim(), summary: '' })
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

  if (campaignError) {
    return (
      <div className="flex min-h-full items-center justify-center bg-night-950 p-6 text-bone">
        <div className="text-center">
          <p className="font-display text-xl text-blood">{campaignError}</p>
          <Link to="/" className="mt-3 inline-block text-gold underline">Volver a campañas</Link>
        </div>
      </div>
    );
  }

  if (!campaign || archive.loading) {
    return <div className="min-h-full bg-night-950 p-6 text-bone/55">Abriendo el Archivo de campaña…</div>;
  }

  if (campaign.role !== 'dm') {
    return (
      <div className="flex min-h-full items-center justify-center bg-night-950 p-6 text-bone">
        <div className="text-center">
          <p className="font-display text-xl text-blood">El Archivo de campaña es privado del DM.</p>
          <Link to={`/campanas/${id}`} className="mt-3 inline-block text-gold underline">Volver a la mesa</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-night-950 text-bone">
      <header className="border-b border-gold/20 bg-night-900/95 px-4 py-3 shadow-lg shadow-black/20">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="font-display text-2xl tracking-wide text-gold">Archivo de campaña</h1>
              <span className="truncate text-sm text-bone/55">{campaign.name}</span>
            </div>
            <p className="text-xs text-bone/40">El centro de preparación para ordenar el lore y los recursos narrativos del DM.</p>
          </div>

          <label className="relative block w-full xl:w-72">
            <span className="sr-only">Buscar en el Archivo</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar títulos, resúmenes o bloques…"
              className="w-full rounded-sm border border-gold/20 bg-night-950 py-2 pl-3 pr-9 text-sm text-bone placeholder:text-bone/30 focus:border-gold focus:outline-none"
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

          <nav className="flex flex-wrap gap-1.5 text-xs">
            <Link to={`/campanas/${id}`} className="rounded-sm border border-gold/30 px-2.5 py-1.5 text-gold hover:bg-gold/10">
              Mesa
            </Link>
            {campaign.hasWorldMap && (
              <Link to={`/campanas/${id}/mundo`} className="rounded-sm border border-bone/20 px-2.5 py-1.5 text-bone/70 hover:border-gold hover:text-gold">
                Mundo
              </Link>
            )}
            <Link to={`/campanas/${id}/editor`} className="rounded-sm border border-bone/20 px-2.5 py-1.5 text-bone/70 hover:border-gold hover:text-gold">
              Mapas
            </Link>
            <Link to={`/campanas/${id}/gestion`} className="rounded-sm border border-bone/20 px-2.5 py-1.5 text-bone/70 hover:border-gold hover:text-gold">
              Gestión
            </Link>
          </nav>
        </div>
      </header>

      {(archive.error || campaignError) && (
        <div className="border-b border-blood/25 bg-blood/10 px-4 py-2 text-center text-sm text-blood">
          {archive.error || campaignError}
        </div>
      )}

      <div className="flex border-b border-gold/15 bg-night-900 lg:hidden">
        <button type="button" onClick={() => setMobilePane('secciones')} className={paneButton(mobilePane === 'secciones')}>
          Secciones
        </button>
        <button type="button" onClick={() => setMobilePane('entradas')} className={paneButton(mobilePane === 'entradas')}>
          Entradas
        </button>
        <button type="button" onClick={() => setMobilePane('editor')} className={paneButton(mobilePane === 'editor')}>
          Editar
        </button>
      </div>

      <main className="mx-auto max-w-[1600px] lg:grid lg:h-[calc(100vh-6.8rem)] lg:grid-cols-[260px_320px_minmax(0,1fr)] lg:border-x lg:border-gold/10">
        <div className={mobilePane === 'secciones' ? 'block' : 'hidden lg:block'}>
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
          />
        </div>

        <div className={mobilePane === 'entradas' ? 'block' : 'hidden lg:block'}>
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
          />
        </div>

        <div className={mobilePane === 'editor' ? 'block' : 'hidden lg:block'}>
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
          />
        </div>
      </main>
    </div>
  );
}
