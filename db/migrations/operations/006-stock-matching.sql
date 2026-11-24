CREATE INDEX IF NOT EXISTS stock_lot_available_location_idx ON stock_lot USING GIST (location)
    WHERE received_quantity - reserved_quantity - delivered_quantity > 0;
