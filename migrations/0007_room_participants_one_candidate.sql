CREATE UNIQUE INDEX idx_room_participants_one_candidate
  ON room_participants(room_id)
  WHERE role_in_room = 'candidate';
