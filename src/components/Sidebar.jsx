import React, { useState, useEffect, useRef } from "react";
import {
  subscribeProjects,
  subscribeSections,
  createSection,
  deleteProject,
  deleteSection,
  updateSectionName,
} from "../firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import NewProjectModal from "./NewProjectModal";
import ImportSectionModal from "./ImportSectionModal";

export default function Sidebar({ activeSection, onSelectSection }) {
  const { user } = useAuth();
  const { show } = useToast();
  const [projects, setProjects] = useState([]);
  const [sections, setSections] = useState({}); // { [projectId]: Section[] }
  const [expanded, setExpanded] = useState({});
  const [showNewProject, setShowNewProject] = useState(false);
  const [importTarget, setImportTarget] = useState(null); // projectId
  const [ctx, setCtx] = useState(null); // context menu state
  const [editingSection, setEditingSection] = useState(null); // { id, projectId, name }
  const [editName, setEditName] = useState("");
  const ctxRef = useRef();

  useEffect(() => {
    const unsub = subscribeProjects(user.uid, setProjects);
    return unsub;
  }, [user.uid]);

  // Subscribe to sections for each project
  useEffect(() => {
    const unsubs = projects.map((p) =>
      subscribeSections(user.uid, p.id, (secs) => {
        setSections((prev) => ({ ...prev, [p.id]: secs }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [projects]);

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtx(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleExpand = (pid) =>
    setExpanded((e) => ({ ...e, [pid]: !e[pid] }));

  const showCtx = (e, type, payload) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, type, payload });
  };

  const handleCtxAction = async (action) => {
    if (!ctx) return;
    const { type, payload } = ctx;
    setCtx(null);
    try {
      if (action === "delete-project" && type === "project") {
        if (window.confirm(`Are you sure you want to delete project "${payload.name}" and all its sections?`)) {
          await deleteProject(user.uid, payload.id);
          show("Project deleted", "info");
          if (activeSection?.projectId === payload.id) onSelectSection(null);
        }
      } else if (action === "delete-section" && type === "section") {
        if (window.confirm(`Are you sure you want to delete section "${payload.name}"?`)) {
          await deleteSection(user.uid, payload.projectId, payload.id);
          show("Section deleted", "info");
          if (activeSection?.id === payload.id) onSelectSection(null);
        }
      } else if (action === "rename-section" && type === "section") {
        setEditingSection(payload);
        setEditName(payload.name);
      } else if (action === "import" && type === "project") {
        setImportTarget(payload.id);
      }
    } catch (err) {
      show("Operation failed: " + err.message, "error");
    }
  };

  const handleSaveRename = async () => {
    if (!editingSection || !editName.trim()) return;
    try {
      await updateSectionName(user.uid, editingSection.projectId, editingSection.id, editName.trim());
      show("Section renamed", "success");
      if (activeSection?.id === editingSection.id) {
        onSelectSection({ ...activeSection, name: editName.trim() });
      }
      setEditingSection(null);
    } catch (err) {
      show("Failed to rename: " + err.message, "error");
    }
  };

  return (
    <aside className="app-sidebar">
      <div className="sidebar-header">
        <span className="text-sm" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
          PROJECTS
        </span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowNewProject(true)}
          title="New project"
        >
          + New
        </button>
      </div>

      <div className="sidebar-body">
        {projects.length === 0 && (
          <div style={{ padding: "var(--sp-6) var(--sp-4)", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: "var(--sp-2)", opacity: 0.3 }}>📁</div>
            <div className="text-sm text-muted">No projects yet.</div>
            <div className="text-sm text-muted">Click + New to get started.</div>
          </div>
        )}

        {projects.map((project) => {
          const isOpen = !!expanded[project.id];
          const secs = sections[project.id] ?? [];

          return (
            <div key={project.id}>
              {/* Project row */}
              <div
                className="project-item"
                onClick={() => toggleExpand(project.id)}
                onContextMenu={(e) => showCtx(e, "project", project)}
              >
                <span className={`project-toggle ${isOpen ? "open" : ""}`}>▶</span>
                <span className="project-icon">📁</span>
                <span className="project-name truncate" title={project.name}>
                  {project.name}
                </span>
                <div className="project-actions">
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    title="Import section"
                    onClick={(e) => { e.stopPropagation(); setImportTarget(project.id); }}
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    title="More options"
                    onClick={(e) => showCtx(e, "project", project)}
                  >
                    ⋯
                  </button>
                </div>
              </div>

              {/* Section list */}
              {isOpen && (
                <div className="section-list">
                  {secs.map((sec) => (
                    <div
                      key={sec.id}
                      className={`section-item ${activeSection?.id === sec.id ? "active" : ""}`}
                      onClick={() => onSelectSection({ ...sec, projectId: project.id, project })}
                      onContextMenu={(e) => showCtx(e, "section", { ...sec, projectId: project.id })}
                    >
                      <div className="section-dot" />
                      {editingSection?.id === sec.id ? (
                        <input
                          type="text"
                          className="input input-sm"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveRename();
                            if (e.key === "Escape") setEditingSection(null);
                          }}
                          onBlur={handleSaveRename}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            padding: "2px 6px",
                            fontSize: 12,
                            height: 24,
                            width: "100%",
                          }}
                        />
                      ) : (
                        <>
                          <span className="section-name truncate" title={sec.name}>{sec.name}</span>
                          {sec.rowCount > 0 && (
                            <span className="badge badge-gray text-sm">
                              {sec.rowCount.toLocaleString()}
                            </span>
                          )}
                          <div className="section-actions" style={{ display: "flex", gap: 2 }}>
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              title="Section options"
                              onClick={(e) => {
                                e.stopPropagation();
                                showCtx(e, "section", { ...sec, projectId: project.id });
                              }}
                              style={{ padding: "2px 4px", fontSize: 11 }}
                            >
                              ⋯
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  <button
                    className="add-section-btn"
                    onClick={() => setImportTarget(project.id)}
                  >
                    + Add Section
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modals */}
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(pid) => setExpanded((e) => ({ ...e, [pid]: true }))}
        />
      )}
      {importTarget && (
        <ImportSectionModal
          projectId={importTarget}
          onClose={() => setImportTarget(null)}
          onImported={(secId, secName) => {
            const proj = projects.find((p) => p.id === importTarget);
            if (proj) onSelectSection({ id: secId, name: secName, projectId: importTarget, project: proj });
            setImportTarget(null);
          }}
        />
      )}

      {/* Context menu */}
      {ctx && (
        <div
          className="ctx-menu"
          ref={ctxRef}
          style={{ top: ctx.y, left: ctx.x }}
        >
          {ctx.type === "project" && (
            <>
              <div className="ctx-item" onClick={() => handleCtxAction("import")}>
                ↑ Import Section
              </div>
              <div className="ctx-item danger" onClick={() => handleCtxAction("delete-project")}>
                🗑 Delete Project
              </div>
            </>
          )}
          {ctx.type === "section" && (
            <>
              <div className="ctx-item" onClick={() => handleCtxAction("rename-section")}>
                ✏️ Rename Section
              </div>
              <div className="ctx-item danger" onClick={() => handleCtxAction("delete-section")}>
                🗑 Delete Section
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
