-- The landed-cost true-up queue's outcome is a declared lifecycle
-- (lib/lifecycles.ts, 'true_up_queue'). Until now it was free text: the
-- queue trigger writes 'pending', the drain (app/api/landed/autopost)
-- writes 'held' or 'error', and a posted row is deleted.
--
-- Every row already satisfied this list when it was added (2026-11-10:
-- one row, 'held'). lib/lifecycles.test.ts holds this list to the
-- declared states.

ALTER TABLE public."30.5_landed_true_up_queue" DROP CONSTRAINT IF EXISTS landed_true_up_queue_outcome_valid;
ALTER TABLE public."30.5_landed_true_up_queue" ADD CONSTRAINT landed_true_up_queue_outcome_valid
  CHECK (outcome IN ('pending', 'held', 'error'));
