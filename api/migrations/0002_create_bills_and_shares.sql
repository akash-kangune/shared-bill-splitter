CREATE TABLE bills (
    id TEXT PRIMARY KEY NOT NULL,
    home_id TEXT NOT NULL,
    title TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    CONSTRAINT bills_positive_total CHECK (total_cents > 0),
    CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0),
    CONSTRAINT bills_home_fk
        FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

CREATE TABLE shares (
    id TEXT PRIMARY KEY NOT NULL,
    bill_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    paid_at TEXT,
    idempotency_key TEXT UNIQUE,
    CONSTRAINT shares_positive_amount CHECK (amount_cents > 0),
    CONSTRAINT shares_bill_fk
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
    CONSTRAINT shares_member_fk
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX idx_bills_home_id ON bills(home_id);
CREATE INDEX idx_shares_bill_id ON shares(bill_id);
CREATE INDEX idx_shares_member_id ON shares(member_id);
