ALTER TABLE expenses ADD COLUMN split_type TEXT DEFAULT 'equal';

ALTER TABLE expense_splits ADD COLUMN amount REAL;