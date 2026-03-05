
CREATE TABLE group_collaborators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  can_edit BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_group_collaborators_group ON group_collaborators(group_id);
CREATE INDEX idx_group_collaborators_user ON group_collaborators(user_id);

CREATE TABLE access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_access_requests_group ON access_requests(group_id);
CREATE INDEX idx_access_requests_status ON access_requests(status);
