import "dotenv/config";
import prisma from "../src/client";

// Re-runnable: only touches rows whose email starts with "seed."
const USER_PASSWORD = "User@1234";
const HOSPITAL_PASSWORD = "Hospital@123";

// Bun's bcrypt output is compatible with the backend's bcrypt.compare
const hash = (password: string) =>
  Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });

const hospitals = [
  {
    email: "seed.citycare@example.com",
    hopitalname: "City Care Hospital",
    location: "Kolkata",
    tests: [
      { name: "Complete Blood Count", price: 350 },
      { name: "Lipid Profile", price: 700 },
      { name: "Thyroid Profile", price: 550 },
      { name: "HbA1c", price: 450 },
      { name: "X-Ray Chest", price: 400 },
    ],
  },
  {
    email: "seed.greenvalley@example.com",
    hopitalname: "Green Valley Diagnostics",
    location: "Bengaluru",
    tests: [
      { name: "Complete Blood Count", price: 300 },
      { name: "Vitamin D", price: 1200 },
      { name: "Liver Function Test", price: 800 },
      { name: "Kidney Function Test", price: 750 },
      { name: "Urine Routine", price: 150 },
    ],
  },
  {
    email: "seed.sunrise@example.com",
    hopitalname: "Sunrise Medical Centre",
    location: "Mumbai",
    tests: [
      { name: "Lipid Profile", price: 850 },
      { name: "MRI Brain", price: 6500 },
      { name: "CT Scan Abdomen", price: 4500 },
      { name: "Thyroid Profile", price: 600 },
    ],
  },
  {
    email: "seed.riverside@example.com",
    hopitalname: "Riverside Health Clinic",
    location: "Delhi",
    tests: [],
  },
];

const users = [
  { email: "seed.asha@example.com", username: "asha" },
  { email: "seed.rahul@example.com", username: "rahul" },
  { email: "seed.priya@example.com", username: "priya" },
  { email: "seed.nobookings@example.com", username: "newuser" },
];

// [user email, hospital email, test name, status, paymentStatus]
const bookings: [string, string, string, string, string][] = [
  ["seed.asha@example.com", "seed.citycare@example.com", "Complete Blood Count", "completed", "paid"],
  ["seed.asha@example.com", "seed.citycare@example.com", "Lipid Profile", "confirmed", "paid"],
  ["seed.asha@example.com", "seed.sunrise@example.com", "MRI Brain", "pending", "pending"],
  ["seed.rahul@example.com", "seed.greenvalley@example.com", "Vitamin D", "confirmed", "paid"],
  ["seed.rahul@example.com", "seed.greenvalley@example.com", "Urine Routine", "cancelled", "refunded"],
  ["seed.priya@example.com", "seed.sunrise@example.com", "Thyroid Profile", "pending", "failed"],
  ["seed.priya@example.com", "seed.citycare@example.com", "HbA1c", "completed", "paid"],
];

async function main() {
  const userPasswordHash = await hash(USER_PASSWORD);
  const hospitalPasswordHash = await hash(HOSPITAL_PASSWORD);

  const seedHospitalEmails = hospitals.map((h) => h.email);
  const seedUserEmails = users.map((u) => u.email);

  // clear previous seed bookings/tests so re-runs don't duplicate them
  await prisma.booking.deleteMany({
    where: {
      OR: [
        { user: { email: { in: seedUserEmails } } },
        { test: { hospital: { email: { in: seedHospitalEmails } } } },
      ],
    },
  });
  await prisma.test.deleteMany({
    where: { hospital: { email: { in: seedHospitalEmails } } },
  });

  const testIds = new Map<string, string>();
  for (const h of hospitals) {
    const data = {
      hopitalname: h.hopitalname,
      location: h.location,
      password: hospitalPasswordHash,
      refrestoken: "",
    };
    const hospital = await prisma.hospital.upsert({
      where: { email: h.email },
      update: data,
      create: { email: h.email, ...data },
    });
    for (const t of h.tests) {
      const test = await prisma.test.create({
        data: { ...t, hospitalId: hospital.id },
      });
      testIds.set(`${h.email}|${t.name}`, test.id);
    }
  }

  const userIds = new Map<string, string>();
  for (const u of users) {
    const data = { username: u.username, password: userPasswordHash, refreshtoken: "" };
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: data,
      create: { email: u.email, ...data },
    });
    userIds.set(u.email, user.id);
  }

  for (const [userEmail, hospitalEmail, testName, status, paymentStatus] of bookings) {
    await prisma.booking.create({
      data: {
        userId: userIds.get(userEmail)!,
        testId: testIds.get(`${hospitalEmail}|${testName}`)!,
        status,
        paymentStatus,
      },
    });
  }

  console.log(
    `Seeded ${hospitals.length} hospitals, ${testIds.size} tests, ${users.length} users, ${bookings.length} bookings`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
