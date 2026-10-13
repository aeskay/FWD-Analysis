import React, { useState } from "react";
import { createProject } from "../firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export default function NewProjectModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const { show } = useToast();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const ref = await createProject(user.uid, name.trim());
      show("Project created successfully!", "success");
      onCreated?.(ref.id);
      onClose();
    } catch (err) {
      show("Failed to create project: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h3>New Project</h3>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Project Name</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. US-87 Lubbock Section 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !name.trim()}
            >
              {loading ? <><span className="spinner" />Creating…</> : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
