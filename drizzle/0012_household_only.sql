-- Slice 17: Coruscant bildet nur das gemeinsame Vermögen ab (Option A).
UPDATE `financial_contracts` SET `sphere` = 'household' WHERE `sphere` = 'personal';
