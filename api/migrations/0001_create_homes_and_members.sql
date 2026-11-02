CREATE TABLE homes (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
    id TEXT PRIMARY KEY NOT NULL,
    home_id TEXT NOT NULL,
    name TEXT NOT NULL,
    CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0),
    CONSTRAINT members_home_fk
        FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

CREATE INDEX idx_members_home_id ON members(home_id);
