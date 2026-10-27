-- Phase 6: paid events. A registration waits for its payment before it counts as confirmed.
ALTER TABLE event_registrations DROP CONSTRAINT event_registrations_status_check;
ALTER TABLE event_registrations ADD CONSTRAINT event_registrations_status_check
  CHECK (status IN ('registered', 'pending', 'approved', 'rejected', 'cancelled', 'waitlisted', 'awaiting_payment'));
ALTER TABLE event_registrations ADD COLUMN payment_request_id uuid;
