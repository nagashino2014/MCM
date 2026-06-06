-- Align organization tree ordering with the current company position hierarchy.

UPDATE positions SET rank_order = 100, updated_at = now()::text WHERE position_id = 'ceo';
UPDATE positions SET rank_order = 95,  updated_at = now()::text WHERE position_id = 'executive-director';
UPDATE positions SET rank_order = 90,  updated_at = now()::text WHERE position_id = 'senior-managing-director';
UPDATE positions SET rank_order = 86,  updated_at = now()::text WHERE position_id = 'general-director';
UPDATE positions SET rank_order = 84,  updated_at = now()::text WHERE position_id = 'director';
UPDATE positions SET rank_order = 82,  updated_at = now()::text WHERE position_id = 'lab-director';
UPDATE positions SET rank_order = 80,  updated_at = now()::text WHERE position_id = 'ulsan-branch-head';
UPDATE positions SET rank_order = 70,  updated_at = now()::text WHERE position_id = 'general-manager';
UPDATE positions SET rank_order = 65,  updated_at = now()::text WHERE position_id = 'advisor';
UPDATE positions SET rank_order = 60,  updated_at = now()::text WHERE position_id = 'deputy-general-manager';
UPDATE positions SET rank_order = 50,  updated_at = now()::text WHERE position_id = 'manager';
UPDATE positions SET rank_order = 40,  updated_at = now()::text WHERE position_id = 'assistant-manager';
UPDATE positions SET rank_order = 30,  updated_at = now()::text WHERE position_id = 'staff';
UPDATE positions SET rank_order = 45,  updated_at = now()::text WHERE position_id = 'senior-researcher';
UPDATE positions SET rank_order = 35,  updated_at = now()::text WHERE position_id = 'associate-researcher';
