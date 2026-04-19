# Daystar Bus Booking System - Project Structure

## Directory Layout

```
daystar-bus-system/
│
├── 📁 frontend/                    # Frontend application
│   ├── 📄 index.html               # Landing page
│   ├── 📄 campus.html              # Campus & destination selection
│   ├── 📄 trips.html               # Bus list & professional seat selection
│   ├── 📄 payment.html             # M-Pesa payment processing
│   ├── 📄 ticket.html              # QR code ticket display
│   │
│   └── 📁 css/
│       └── 📄 styles.css           # Global stylesheet (230+ lines)
│
├── 📁 backend/                     # Node.js/Express server
│   ├── 📄 server.js                # Main Express application
│   │
│   ├── 📁 routes/                  # API route handlers
│   │   ├── 📄 buses.js             # GET /api/buses endpoints
│   │   ├── 📄 bookings.js          # POST /api/bookings endpoints
│   │   └── 📄 payments.js          # POST /api/payments/mpesa endpoints
│   │
│   ├── 📁 controllers/             # (Placeholder for future)
│   │
│   └── 📁 database/                # (Placeholder for future DB files)
│
├── 📁 database/                    # Database files & schema
│   └── 📄 schema.sql               # Complete SQLite schema with 6 tables
│
├── 📄 package.json                 # Node.js dependencies & scripts
├── 📄 .env                         # Environment variables
├── 📄 .gitignore                   # Git ignore rules
├── 📄 README.md                    # Project documentation
└── 📄 STRUCTURE.md                 # This file
```

## File Descriptions

### Frontend Files

**index.html** (60 lines)
- Landing page with welcome message
- Bottom navigation (Home, Location, Settings, Admin)
- Responsive CSS gradient background
- Quick start button directing to campus.html

**campus.html** (200 lines)
- Campus selector (Nairobi / Athi River)
- Day selector (Monday-Sunday)
- Time selector (loads dynamically)
- Destination selector (dynamic based on campus)
- Fare calculation (150 for Syokimau, 200 for Athi)
- localStorage integration

**trips.html** (1000+ lines)
- Bus configuration object (busLayouts)
- 45-seat & 29-seat bus layouts
- Professional bus modal with details
- Dynamic seat map rendering
- Live booking summary panel (right side sticky)
- Seat states: Available, Selected, Booked, Reserved
- Real-time fare calculation
- Proceed to payment button (disabled until seats selected)

**payment.html** (200 lines)
- Booking summary from localStorage
- M-Pesa phone validation (^07\d{8}$)
- Amount calculation display
- STK push simulation
- Ticket ID generation
- Redirect to ticket.html

**ticket.html** (350 lines)
- Ticket information display
- QR code generation (using qrcode.js CDN)
- QR data: ticketID, busPlate, seats, time, destination
- Download and home buttons
- localStorage cleanup on home return

**css/styles.css** (230 lines)
- Global styles for all pages
- Seat styling: white, blue glow, red glow, grey
- Grid layouts for seat maps
- Responsive media queries
- Button and form styling

### Backend Files

**server.js** (40 lines)
- Express server initialization
- CORS middleware enabled
- Body parser for JSON
- Static file serving from frontend/
- API routes registration
- Health check endpoint
- Error handling middleware

**routes/buses.js** (45 lines)
- GET /api/buses - Get all buses with configs
- GET /api/buses/:plate - Get single bus
- 8 buses: 4 NEW (45 seats), 4 OLD (29 seats)

**routes/bookings.js** (55 lines)
- GET /api/bookings - List bookings
- POST /api/bookings - Create new booking
- GET /api/bookings/:bookingId - Get booking details
- Booking validation
- Booking ID generation

**routes/payments.js** (60 lines)
- POST /api/payments/mpesa - Process M-Pesa payment
- Phone validation (07XXXXXXXX)
- Amount validation
- Transaction ID generation
- GET /api/payments/verify/:transactionId

### Database Files

**schema.sql** (150 lines)
- Buses table (8 buses initialized)
- Routes table (6 route combinations)
- Bookings table
- Payments table
- Tickets table
- Seat reservations table
- Indexes for performance optimization

### Configuration Files

**package.json**
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "dotenv": "^16.0.3",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2"
  }
}
```

**.env**
```
PORT=3000
NODE_ENV=development
DB_PATH=./database/daystar.db
```

**.gitignore**
- node_modules/
- .env
- *.db
- .DS_Store
- dist/, build/

## Bus Configuration

### Bus Layout Configuration
```javascript
const busLayouts = {
    "KDA347R": { capacity: 45, type: "new" },  // 2-aisle-3
    "KDC234K": { capacity: 45, type: "new" },
    "KDE456K": { capacity: 45, type: "new" },
    "KCY564K": { capacity: 45, type: "new" },
    "KCU978S": { capacity: 29, type: "old" },  // 2-aisle-2
    "KBX319D": { capacity: 29, type: "old" },
    "KBX514D": { capacity: 29, type: "old" },
    "KCU453E": { capacity: 29, type: "old" }
};
```

### Seat States CSS
- **.seat.available**: white background
- **.seat.selected**: blue (#3498db) with glow
- **.seat.booked**: red (#e74c3c) with glow
- **.seat.reserved**: grey (#95a5a6)

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Server health check |
| GET | `/api/buses` | Get all buses |
| GET | `/api/buses/:plate` | Get bus details |
| POST | `/api/bookings` | Create booking |
| GET | `/api/bookings/:id` | Get booking details |
| POST | `/api/payments/mpesa` | Process M-Pesa |
| GET | `/api/payments/verify/:txId` | Verify payment |

## User Flow

1. **index.html**
   - Landing page with welcome message
   - Click "Get Started" → campus.html

2. **campus.html**
   - Select campus (Nairobi/Athi)
   - Select day
   - Select time (loads dynamically)
   - Select destination (dynamic based on campus)
   - Click "Show Available Buses" → trips.html

3. **trips.html**
   - View list of available buses
   - Click bus → Modal shows details
   - View Seats → Opens seat map
   - Dynamic layout: 2-aisle-3 (45 seats) or 2-aisle-2 (29 seats)
   - Live booking summary on right
   - Seats 1 & 2 reserved (grey)
   - Click seats to select/deselect
   - Click "Proceed to Payment" → payment.html

4. **payment.html**
   - Review booking summary
   - Enter M-Pesa number (07XXXXXXXX)
   - Click "Pay Now" → Validates, generates ticket ID
   - Redirect → ticket.html

5. **ticket.html**
   - Display ticket details
   - Show QR code (contains ticket data)
   - Download or return home

## Features Implemented

✅ Campus & destination selection
✅ Dynamic bus scheduling by day/time
✅ Professional bus modal
✅ Dynamic seat layouts (45 & 29 seats)
✅ Seat states (Available, Selected, Booked, Reserved)
✅ Live booking summary panel
✅ Real-time fare calculation
✅ M-Pesa payment validation
✅ QR code ticket generation
✅ localStorage data persistence
✅ Responsive design
✅ RESTful API structure
✅ SQLite database schema
✅ Error handling

## Setup & Running

### Development
```bash
cd daystar-bus-system
npm install
npm run dev
```

### Production
```bash
npm start
```

### Access
- Frontend: http://localhost:3000
- API: http://localhost:3000/api

---

**Project Status**: Fully structured and ready for development
**Last Updated**: March 13, 2026
