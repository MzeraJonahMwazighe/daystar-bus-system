// Creates (or updates) one staff account. This is the only way to create a super admin.
//
// Usage:
//   node backend/scripts/create-staff.js --email you@daystar.ac.ke --name "Your Name" --role super_admin
//   node backend/scripts/create-staff.js --email admin@daystar.ac.ke --name "Athi Admin" --role campus_admin --campus athi
//
// Options: --email, --name, --role (super_admin | campus_admin | driver),
//          --campus (athi | nairobi; required for campus_admin), --phone, --deactivate
//
// If the email already exists, only the options you pass are changed (scoped by email).
require('dotenv').config();

const mongoose = require('mongoose');
const Staff = require('../models/Staff');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'deactivate') {
      args.deactivate = true;
      continue;
    }
    args[name] = argv[index + 1];
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || '').trim().toLowerCase();

  if (!email) {
    throw new Error('--email is required');
  }
  if (args.role && !Staff.STAFF_ROLES.includes(args.role)) {
    throw new Error(`--role must be one of: ${Staff.STAFF_ROLES.join(', ')}`);
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured');
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Staff.init();

  let staff = await Staff.findOne({ email });
  const action = staff ? 'UPDATED' : 'CREATED';

  if (!staff) {
    if (!args.name || !args.role) {
      throw new Error('--name and --role are required when creating a new staff account');
    }
    staff = new Staff({ email });
  }

  if (args.name) staff.name = args.name;
  if (args.role) staff.role = args.role;
  if (args.campus !== undefined) staff.campus = args.campus || null;
  if (args.phone !== undefined) staff.phone_number = args.phone || undefined;
  staff.active = !args.deactivate;

  await staff.save();

  console.log(`${action} staff account:`, JSON.stringify({
    id: String(staff._id),
    email: staff.email,
    name: staff.name,
    role: staff.role,
    campus: staff.campus,
    active: staff.active
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('CREATE STAFF ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
