-- Conference papers (EVT-11): an event can open a call for papers on one of the tenant's paper
-- tracks. Seeing the event, registering and submitting a paper are three separate rules (EVT-02).
ALTER TABLE events ADD COLUMN paper_deadline timestamptz;
ALTER TABLE events ADD COLUMN paper_rule jsonb;
ALTER TABLE events ADD CONSTRAINT events_paper_track_fk FOREIGN KEY (tenant_id, paper_track_id) REFERENCES paper_tracks (tenant_id, id);

ALTER TABLE papers ADD COLUMN event_id uuid;
ALTER TABLE papers ADD CONSTRAINT papers_event_fk FOREIGN KEY (tenant_id, event_id) REFERENCES events (tenant_id, id);
CREATE INDEX papers_event_idx ON papers (tenant_id, event_id) WHERE event_id IS NOT NULL;
