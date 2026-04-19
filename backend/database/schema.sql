-- Daystar Bus Booking System Database Schema

-- Buses table
CREATE TABLE buses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate TEXT UNIQUE NOT NULL,
    capacity INTEGER NOT NULL,
    type TEXT NOT NULL,
    route TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bus routes
CREATE TABLE routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_location TEXT NOT NULL,
    to_location TEXT NOT NULL,
    fare_per_seat INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bookings
CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT UNIQUE NOT NULL,
    bus_id INTEGER NOT NULL,
    seats TEXT NOT NULL,
    destination TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bus_id) REFERENCES buses(id)
);

-- Payments
CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT UNIQUE NOT NULL,
    booking_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'mpesa',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
);

-- Tickets
CREATE TABLE tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT UNIQUE NOT NULL,
    booking_id TEXT NOT NULL,
    bus_id INTEGER NOT NULL,
    seats TEXT NOT NULL,
    destination TEXT NOT NULL,
    amount INTEGER NOT NULL,
    qr_data TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
    FOREIGN KEY (bus_id) REFERENCES buses(id)
);

-- Bus seat reservations
CREATE TABLE seat_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    seat_number INTEGER NOT NULL,
    booking_id TEXT,
    reserved_by TEXT NOT NULL,
    status TEXT DEFAULT 'reserved',
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
    UNIQUE(trip_id, seat_number)
);

-- Initialize bus data
INSERT INTO buses (plate, capacity, type, route) VALUES
('KDA347R', 45, 'new', 'nairobi-athi'),
('KDC234K', 45, 'new', 'nairobi-athi'),
('KDE456K', 45, 'new', 'nairobi-athi'),
('KCY564K', 45, 'new', 'nairobi-athi'),
('KCU978S', 29, 'old', 'nairobi-athi'),
('KBX319D', 29, 'old', 'nairobi-athi'),
('KBX514D', 29, 'old', 'nairobi-athi'),
('KCU453E', 29, 'old', 'nairobi-athi');

-- Initialize routes
INSERT INTO routes (from_location, to_location, fare_per_seat) VALUES
('nairobi', 'athi', 200),
('athi', 'nairobi', 200),
('nairobi', 'syokimau', 150),
('syokimau', 'nairobi', 150),
('athi', 'syokimau', 150),
('syokimau', 'athi', 150);

-- Create indexes for better performance
CREATE INDEX idx_bookings_booking_id ON bookings(booking_id);
CREATE INDEX idx_payments_booking_id ON payments(booking_id);
CREATE INDEX idx_tickets_ticket_id ON tickets(ticket_id);
CREATE INDEX idx_seat_reservations_trip_id ON seat_reservations(trip_id);

-- Trips table
CREATE TABLE trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id INTEGER NOT NULL,
    route_id INTEGER NOT NULL,
    trip_date TEXT NOT NULL,
    departure_time TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bus_id) REFERENCES buses(id),
    FOREIGN KEY (route_id) REFERENCES routes(id)
);
