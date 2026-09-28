// OpenAPI 3 spec for every route, served by swagger-ui at /docs and as JSON at /docs/openapi.json.
// written by hand, so update it whenever a route or its request/response changes

const message = (example: string) => ({
    type: "object",
    properties: { message: { type: "string", example } },
})

const errors = {
    400: { description: "invalid request", content: { "application/json": { schema: message("enter a valid booking id") } } },
    401: { description: "missing, invalid or expired token", content: { "application/json": { schema: message("Invalid or expired token") } } },
    404: { description: "not found, or it belongs to someone else", content: { "application/json": { schema: message("booking not found") } } },
    409: { description: "the resource is in a state that doesn't allow this", content: { "application/json": { schema: message("booking is already cancelled") } } },
    429: { description: "rate limited", content: { "application/json": { schema: message("too many requests, slow down") } } },
}

const json = (schema: object) => ({ required: true, content: { "application/json": { schema } } })
const ok = (description: string, schema: object) => ({ description, content: { "application/json": { schema } } })
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } })

const userAuth = [{ userBearer: [] }]
const hospitalAuth = [{ hospitalBearer: [] }]

export const openapiSpec = {
    openapi: "3.0.3",
    info: {
        title: "eve-care API",
        version: "1.0.0",
        description:
            "Diagnostic test bookings with a simulated payment provider.\n\n" +
            "Sign in to get an `accessToken` (15 min) and click **Authorize**. Users and hospitals have separate tokens: " +
            "a user token is rejected on hospital routes and the other way round.\n\n" +
            "Payment flow: `POST /api/user/booking/booking` → `POST /payments` → the mock provider calls " +
            "`POST /payments/webhook` ~1.5s later → poll `GET /payments/{id}`.",
    },
    servers: [{ url: "/" }],
    tags: [
        { name: "User auth" },
        { name: "Hospital auth" },
        { name: "Centres", description: "public, no token needed" },
        { name: "Hospital tests", description: "a hospital managing its own tests" },
        { name: "Bookings" },
        { name: "Payments" },
    ],
    components: {
        securitySchemes: {
            userBearer: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "accessToken from /api/user/auth/signin" },
            hospitalBearer: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "accessToken from /api/hospital/auth/signin" },
            webhookSignature: { type: "apiKey", in: "header", name: "X-Webhook-Signature", description: "hex HMAC-SHA256 of the raw body with WEBHOOK_SECRET" },
        },
        schemas: {
            Test: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string", example: "Lipid Profile" },
                    price: { type: "integer", example: 700 },
                    hospitalId: { type: "string", format: "uuid" },
                },
            },
            Centre: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    hopitalname: { type: "string", example: "City Care Hospital" },
                    location: { type: "string", example: "Kolkata" },
                },
            },
            Booking: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    userId: { type: "string", format: "uuid" },
                    testId: { type: "string", format: "uuid" },
                    price: { type: "integer", example: 700, description: "copied from the test when booked" },
                    status: { type: "string", enum: ["Pending", "Confirmed", "Failed", "Cancelled"] },
                    date: { type: "string", format: "date-time" },
                    createdAt: { type: "string", format: "date-time" },
                },
            },
            Payment: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    bookingId: { type: "string", format: "uuid" },
                    amount: { type: "integer", example: 700 },
                    status: { type: "string", enum: ["Created", "Success", "Failed", "Refunded"] },
                    failureReason: { type: "string", nullable: true, example: null },
                    createdAt: { type: "string", format: "date-time" },
                },
            },
        },
    },
    paths: {
        "/api/user/auth/signup": {
            post: {
                tags: ["User auth"],
                summary: "create a user account",
                requestBody: json({
                    type: "object",
                    required: ["username", "email", "password"],
                    properties: {
                        username: { type: "string", example: "asha" },
                        email: { type: "string", format: "email", example: "asha@example.com" },
                        password: { type: "string", minLength: 8, example: "User@1234" },
                    },
                }),
                responses: {
                    201: ok("created, message is the new user id", message("3f6c…")),
                    400: errors[400],
                    409: ok("email already in use", message("This email is already in use. use another email")),
                    429: errors[429],
                },
            },
        },
        "/api/user/auth/signin": {
            post: {
                tags: ["User auth"],
                summary: "sign in, returns an access token and sets the refreshToken cookie",
                requestBody: json({
                    type: "object",
                    required: ["email", "password"],
                    properties: {
                        email: { type: "string", format: "email", example: "seed.asha@example.com" },
                        password: { type: "string", example: "User@1234" },
                    },
                }),
                responses: {
                    200: ok("signed in", { type: "object", properties: { accessToken: { type: "string" } } }),
                    400: errors[400],
                    401: ok("wrong email or password", message("Your password is incorrect")),
                    429: errors[429],
                },
            },
        },
        "/api/user/auth/refresh": {
            post: {
                tags: ["User auth"],
                summary: "swap the refreshToken cookie for a new access token (the refresh token is rotated)",
                responses: {
                    200: ok("new token", { type: "object", properties: { accessToken: { type: "string" } } }),
                    401: errors[401],
                },
            },
        },
        "/api/user/auth/logout": {
            post: {
                tags: ["User auth"],
                summary: "revoke the refresh token and clear the cookie",
                responses: { 200: ok("logged out", message("Logged out")), 401: errors[401] },
            },
        },
        "/api/hospital/auth/signup": {
            post: {
                tags: ["Hospital auth"],
                summary: "register a diagnostic centre",
                requestBody: json({
                    type: "object",
                    required: ["hospitalname", "email", "password", "location"],
                    properties: {
                        hospitalname: { type: "string", example: "City Care Hospital" },
                        email: { type: "string", format: "email", example: "citycare@example.com" },
                        password: { type: "string", minLength: 8, example: "Hospital@123" },
                        location: { type: "string", example: "Kolkata" },
                    },
                }),
                responses: {
                    201: ok("created, message is the new hospital id", message("9a1d…")),
                    400: errors[400],
                    409: ok("email or name already registered", message("A hospital with this name is already registered")),
                    429: errors[429],
                },
            },
        },
        "/api/hospital/auth/signin": {
            post: {
                tags: ["Hospital auth"],
                summary: "sign in as a hospital",
                requestBody: json({
                    type: "object",
                    required: ["email", "password"],
                    properties: {
                        email: { type: "string", format: "email", example: "seed.citycare@example.com" },
                        password: { type: "string", example: "Hospital@123" },
                    },
                }),
                responses: {
                    200: ok("signed in", { type: "object", properties: { accessToken: { type: "string" } } }),
                    400: errors[400],
                    401: ok("wrong email or password", message("Your password is incorrect")),
                    429: errors[429],
                },
            },
        },
        "/api/hospital/auth/refresh": {
            post: {
                tags: ["Hospital auth"],
                summary: "swap the hospital refresh cookie for a new access token",
                responses: {
                    200: ok("new token", { type: "object", properties: { accessToken: { type: "string" } } }),
                    401: errors[401],
                },
            },
        },
        "/api/hospital/auth/logout": {
            post: {
                tags: ["Hospital auth"],
                summary: "revoke the hospital refresh token",
                responses: { 200: ok("logged out", message("Logged out")), 401: errors[401] },
            },
        },
        "/api/centres": {
            get: {
                tags: ["Centres"],
                summary: "list centres, paginated",
                parameters: [
                    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
                    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
                    { name: "search", in: "query", description: "part of the centre name, case-insensitive", schema: { type: "string" } },
                    { name: "location", in: "query", description: "part of the location, case-insensitive", schema: { type: "string" } },
                ],
                responses: {
                    200: ok("one page of centres", {
                        type: "object",
                        properties: {
                            centres: {
                                type: "array",
                                items: {
                                    allOf: [
                                        ref("Centre"),
                                        { type: "object", properties: { _count: { type: "object", properties: { Tests: { type: "integer", example: 5 } } } } },
                                    ],
                                },
                            },
                            page: { type: "integer", example: 1 },
                            limit: { type: "integer", example: 10 },
                            total: { type: "integer", example: 4 },
                            totalPages: { type: "integer", example: 1 },
                        },
                    }),
                    400: errors[400],
                },
            },
        },
        "/api/centres/{id}": {
            get: {
                tags: ["Centres"],
                summary: "a centre with every test it offers and its price",
                parameters: [uuidParam("id")],
                responses: {
                    200: ok("the centre", {
                        type: "object",
                        properties: {
                            centre: {
                                allOf: [
                                    ref("Centre"),
                                    {
                                        type: "object",
                                        properties: {
                                            Tests: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, price: { type: "integer" } },
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    }),
                    400: errors[400],
                    404: ok("no centre with this id", message("centre not found")),
                },
            },
        },
        "/api/hospital/tests/my-tests": {
            get: {
                tags: ["Hospital tests"],
                summary: "the signed-in hospital's tests",
                security: hospitalAuth,
                responses: {
                    200: ok("tests", { type: "object", properties: { tests: { type: "array", items: ref("Test") } } }),
                    401: errors[401],
                },
            },
        },
        "/api/hospital/tests/add-test": {
            post: {
                tags: ["Hospital tests"],
                summary: "add a test to the signed-in hospital",
                security: hospitalAuth,
                requestBody: json({
                    type: "object",
                    required: ["name", "price"],
                    properties: { name: { type: "string", example: "Vitamin B12" }, price: { type: "integer", minimum: 1, example: 900 } },
                }),
                responses: {
                    201: ok("created", { type: "object", properties: { test: ref("Test") } }),
                    400: errors[400],
                    401: errors[401],
                },
            },
        },
        "/api/hospital/tests/update-test/{id}": {
            put: {
                tags: ["Hospital tests"],
                summary: "change a test's name and/or price. existing bookings keep the price they were booked at",
                security: hospitalAuth,
                parameters: [uuidParam("id")],
                requestBody: json({
                    type: "object",
                    properties: { name: { type: "string" }, price: { type: "integer", minimum: 1, example: 950 } },
                }),
                responses: {
                    200: ok("updated", { type: "object", properties: { test: ref("Test") } }),
                    400: errors[400],
                    401: errors[401],
                    404: ok("not found, or another hospital's test", message("test not found")),
                },
            },
        },
        "/api/hospital/tests/remove-test/{id}": {
            delete: {
                tags: ["Hospital tests"],
                summary: "delete a test that has never been booked",
                security: hospitalAuth,
                parameters: [uuidParam("id")],
                responses: {
                    200: ok("removed", message("test removed")),
                    400: errors[400],
                    401: errors[401],
                    404: ok("not found, or another hospital's test", message("test not found")),
                    409: ok("the test has bookings", message("this test has bookings and cannot be deleted")),
                },
            },
        },
        "/api/user/booking/search-by-hospital": {
            post: {
                tags: ["Bookings"],
                summary: "tests offered by the first hospital whose name contains the query",
                security: userAuth,
                requestBody: json({ type: "object", required: ["hospital"], properties: { hospital: { type: "string", example: "city care" } } }),
                responses: {
                    200: ok("tests", { type: "object", properties: { tests: { type: "array", items: ref("Test") } } }),
                    400: errors[400],
                    401: errors[401],
                    404: ok("no match", message("this hospital is not in our database")),
                },
            },
        },
        "/api/user/booking/search-by-tests": {
            post: {
                tags: ["Bookings"],
                summary: "every centre offering a test whose name contains the query, with its price there",
                security: userAuth,
                requestBody: json({ type: "object", required: ["testname"], properties: { testname: { type: "string", example: "blood count" } } }),
                responses: {
                    200: ok("matches", {
                        type: "object",
                        properties: {
                            data: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string", format: "uuid" },
                                        name: { type: "string" },
                                        price: { type: "integer" },
                                        hospital: ref("Centre"),
                                    },
                                },
                            },
                        },
                    }),
                    400: errors[400],
                    401: errors[401],
                    404: ok("no match", message("no test with this name is in our database")),
                },
            },
        },
        "/api/user/booking/booking": {
            post: {
                tags: ["Bookings"],
                summary: "book a test. the booking starts Pending with the test's current price",
                security: userAuth,
                requestBody: json({
                    type: "object",
                    required: ["testid", "date"],
                    properties: {
                        testid: { type: "string", format: "uuid" },
                        date: { type: "string", format: "date-time", example: "2026-12-01T10:30:00.000Z", description: "must be in the future, with a timezone" },
                    },
                }),
                responses: {
                    201: ok("created", { type: "object", properties: { booking: ref("Booking") } }),
                    400: errors[400],
                    401: errors[401],
                    404: ok("test not found", message("this test doesnt exist anymore")),
                    409: ok("already has a Pending or Confirmed booking for this test", message("You already have a booking for this test. please check your bookings")),
                },
            },
        },
        "/api/user/booking/bookings": {
            get: {
                tags: ["Bookings"],
                summary: "the signed-in user's bookings, newest first",
                security: userAuth,
                responses: {
                    200: ok("bookings", { type: "object", properties: { bookings: { type: "array", items: ref("Booking") } } }),
                    401: errors[401],
                },
            },
        },
        "/api/user/booking/booking/{id}": {
            get: {
                tags: ["Bookings"],
                summary: "one booking with its test, centre and payment",
                security: userAuth,
                parameters: [uuidParam("id")],
                responses: {
                    200: ok("the booking", { type: "object", properties: { booking: ref("Booking") } }),
                    400: errors[400],
                    401: errors[401],
                    404: errors[404],
                },
            },
        },
        "/api/user/booking/booking/{id}/cancel": {
            post: {
                tags: ["Bookings"],
                summary: "cancel a Pending or Confirmed booking. a paid booking is refunded (simulated)",
                security: userAuth,
                parameters: [uuidParam("id")],
                responses: {
                    200: ok("cancelled", {
                        type: "object",
                        properties: {
                            message: { type: "string", example: "booking cancelled and payment refunded" },
                            bookingId: { type: "string", format: "uuid" },
                            status: { type: "string", example: "Cancelled" },
                            refunded: { type: "boolean" },
                        },
                    }),
                    400: errors[400],
                    401: errors[401],
                    404: errors[404],
                    409: errors[409],
                },
            },
        },
        "/payments": {
            post: {
                tags: ["Payments"],
                summary: "start a simulated payment for a Pending booking",
                description:
                    "Returns 202 with the payment in `Created`. The mock provider then reports SUCCESS (80%) or FAILED to the webhook, " +
                    "which moves the booking to Confirmed or Failed. Pass `simulate` to force the outcome.\n\n" +
                    "Sending the same `Idempotency-Key` again returns the original payment with 200 instead of charging twice.",
                security: userAuth,
                parameters: [
                    { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", format: "uuid" }, description: "a new UUID per payment attempt" },
                ],
                requestBody: json({
                    type: "object",
                    required: ["bookingId"],
                    properties: {
                        bookingId: { type: "string", format: "uuid" },
                        simulate: { type: "string", enum: ["success", "failure"] },
                    },
                }),
                responses: {
                    202: ok("payment started", { type: "object", properties: { payment: ref("Payment") } }),
                    200: ok("replay of an earlier request with the same Idempotency-Key", { type: "object", properties: { payment: ref("Payment") } }),
                    400: errors[400],
                    401: errors[401],
                    404: errors[404],
                    409: ok("booking isn't Pending, or a payment is already running", message("payment already in progress for this booking")),
                    422: ok("Idempotency-Key already used for another booking", message("this Idempotency-Key was already used for a different booking")),
                    429: errors[429],
                },
            },
        },
        "/payments/{id}": {
            get: {
                tags: ["Payments"],
                summary: "a payment and its booking's status (poll this after POST /payments)",
                security: userAuth,
                parameters: [uuidParam("id")],
                responses: {
                    200: ok("the payment", {
                        type: "object",
                        properties: {
                            payment: {
                                allOf: [
                                    ref("Payment"),
                                    { type: "object", properties: { booking: { type: "object", properties: { id: { type: "string" }, status: { type: "string" } } } } },
                                ],
                            },
                        },
                    }),
                    400: errors[400],
                    401: errors[401],
                    404: ok("not found, or another user's payment", message("payment not found")),
                    429: errors[429],
                },
            },
        },
        "/payments/webhook": {
            post: {
                tags: ["Payments"],
                summary: "payment result from the provider. idempotent on eventId",
                description:
                    "Called by the mock provider, not by users. The same eventId is only ever applied once; " +
                    "a repeat answers 200 so the provider stops retrying. An event for a payment that is already settled is ignored.",
                security: [{ webhookSignature: [] }],
                requestBody: json({
                    type: "object",
                    required: ["eventId", "providerRef", "status"],
                    properties: {
                        eventId: { type: "string", example: "evt_4b1f…" },
                        providerRef: { type: "string", example: "mock_pay_9c2e…" },
                        status: { type: "string", enum: ["SUCCESS", "FAILED"] },
                        failureReason: { type: "string", example: "card_declined" },
                    },
                }),
                responses: {
                    200: ok("processed, duplicate, ignored or refunded", message("event already processed")),
                    400: errors[400],
                    401: ok("bad signature", message("invalid signature")),
                    404: ok("unknown providerRef, the provider should retry", message("payment not found")),
                },
            },
        },
    },
}
