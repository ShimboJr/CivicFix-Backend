# CivicFix API Documentation

## Smart Community Problem/Issue & Emergency Reporting and Resolution Platform

**Version:** 2.0  
**API Type:** REST API  
**Backend Stack:** Node.js, Express.js, MongoDB and Mongoose  
**Authentication:** JSON Web Token (JWT)  
**Media Storage:** Cloudinary

---

## Table of Contents

1. [Overview](#1-overview)
2. [Base URL](#2-base-url)
3. [Authentication and Authorization](#3-authentication-and-authorization)
4. [User Roles](#4-user-roles)
5. [General Response and Error Handling](#5-general-response-and-error-handling)
6. [Issue Status Workflow](#6-issue-status-workflow)
7. [Authentication Endpoints](#7-authentication-endpoints)
8. [Public Endpoints](#8-public-endpoints)
9. [Category Endpoints](#9-category-endpoints)
10. [Issue Endpoints](#10-issue-endpoints)
11. [Notification Endpoints](#11-notification-endpoints)
12. [Upload Endpoints](#12-upload-endpoints)
13. [Push Notification Endpoints](#13-push-notification-endpoints)
14. [Staff Endpoints](#14-staff-endpoints)
15. [Administrator Endpoints](#15-administrator-endpoints)
16. [Emergency Reporting Endpoints](#16-emergency-reporting-endpoints)
17. [Live Location Sharing Endpoints](#17-live-location-sharing-endpoints)
18. [HTTP Status Codes](#18-http-status-codes)
19. [Core Data Models](#19-core-data-models)
20. [Security and Validation Features](#20-security-and-validation-features)

---

# 1. Overview

The **CivicFix API** powers CivicFix, a Smart Community Problem/Issue Reporting and Resolution Platform. It provides the backend services required for residents to report community problems, administrators to manage and assign those problems, and staff members to track their progress through to resolution.

The API also provides:

- JWT-based authentication
- Role-based authorization
- Community issue reporting and tracking
- Issue comments and community upvoting
- Duplicate issue detection based on nearby geographical coordinates
- Administrator dashboards and analytics
- Staff workload and assignment management
- In-app notifications
- Web Push subscriptions
- Cloudinary media-upload support
- Before-and-after resolution evidence
- Private emergency reporting
- Emergency operational statistics
- Password reset functionality
- Account login protection and rate limiting
- Issue status audit trails
- Live location sharing for personal-safety emergencies
- Live GPS location trails and session expiry handling
- Silent admin-to-resident emergency messaging
- Resident "I'm Safe" confirmation without stopping tracking

The API exchanges data primarily in **JSON** format. The staff resolution-proof endpoint is an exception and accepts `multipart/form-data`.

---

# 2. Base URL

## Production

```text
https://civicfix-backend.vercel.app/api
```

## Local Development

```text
http://localhost:5000/api
```

All endpoint paths in this documentation are relative to `/api`.

For example:

```http
GET /api/issues
```

---

# 3. Authentication and Authorization

CivicFix uses **JSON Web Tokens (JWT)** to protect private API endpoints.

After successful registration or login, the API returns a JWT:

```json
{
  "_id": "USER_ID",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "resident",
  "token": "JWT_TOKEN"
}
```

For protected endpoints, include the token in the request header:

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

Endpoints that require administrator or staff access use role-based authorization in addition to JWT authentication.

---

# 4. User Roles

| Role | Description |
|---|---|
| `resident` | Default user role. Can report issues, view personal reports, comment, upvote, receive notifications, and submit emergency reports. |
| `staff` | Can view assigned issues, advance issue progress, and upload resolution proof. |
| `admin` | Has administrative access to users, categories, issues, assignments, analytics, and emergency reports. |

> Self-registration always creates a `resident` account. Administrative users can later change a user's role through the admin API.

---

# 5. General Response and Error Handling

CivicFix does not force every endpoint into one identical response envelope. Successful responses return the resource or endpoint-specific data directly.

A typical error response is:

```json
{
  "message": "Issue not found"
}
```

Validation errors may include field-level details:

```json
{
  "message": "Title is required",
  "errors": [
    {
      "field": "title",
      "message": "Title is required"
    }
  ]
}
```

The global error handler exposes stack traces outside production for debugging purposes.

---

# 6. Issue Status Workflow

The primary CivicFix issue lifecycle is:

```text
Pending
   ↓
Under Review
   ↓
Assigned
   ↓
In Progress
   ↓
Resolved
```

An administrator can also reject an issue:

```text
Pending / Under Review / Assigned / In Progress
                    ↓
                 Rejected
```

Valid issue statuses are:

```text
Pending
Under Review
Assigned
In Progress
Resolved
Rejected
```

Staff members can only perform the following forward transitions:

```text
Assigned → In Progress
In Progress → Resolved
```

Administrators can directly set any valid issue status.

---

# 7. Authentication Endpoints

## 7.1 Register a New User

Creates a new CivicFix account. All self-registered users are assigned the `resident` role.

### Endpoint

```http
POST /api/auth/register
```

**Access:** Public

### Request Body

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "location": "Ibadan, Nigeria"
}
```

### Required Fields

| Field | Type | Requirement |
|---|---|---|
| `name` | String | Required, maximum 100 characters |
| `email` | String | Required and must be a valid email |
| `password` | String | Required, minimum 6 characters |
| `location` | String | Required |

### Successful Response — `201 Created`

```json
{
  "_id": "USER_ID",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "resident",
  "token": "JWT_TOKEN"
}
```

### Possible Errors

- `400` — Validation error
- `409` — Email address already exists

---

## 7.2 Login

Authenticates a user and returns a JWT.

### Endpoint

```http
POST /api/auth/login
```

**Access:** Public

### Request Body

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

### Successful Response — `200 OK`

```json
{
  "_id": "USER_ID",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "resident",
  "token": "JWT_TOKEN"
}
```

### Security Controls

- Login attempts are rate limited to **5 attempts per IP address every 15 minutes**.
- Repeated failed attempts can temporarily lock an account.
- Locked accounts return `423 Locked`.
- Invalid credentials return a generic `401` response without revealing whether an email address exists.

---

## 7.3 Get Current User

Returns the authenticated user's profile.

### Endpoint

```http
GET /api/auth/me
```

**Access:** Authenticated users

### Headers

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

### Successful Response — `200 OK`

```json
{
  "_id": "USER_ID",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "resident",
  "location": "Ibadan, Nigeria",
  "createdAt": "2026-09-01T10:00:00.000Z"
}
```

---

## 7.4 Logout

Provides a logout API contract.

### Endpoint

```http
POST /api/auth/logout
```

**Access:** Authenticated users

### Successful Response — `200 OK`

```json
{
  "message": "Logged out successfully"
}
```

> CivicFix uses stateless JWT authentication. The client performs the actual logout by removing the stored token.

---

## 7.5 Request Password Reset

Requests a password-reset email.

### Endpoint

```http
POST /api/auth/forgot-password
```

**Access:** Public

### Request Body

```json
{
  "email": "john@example.com"
}
```

### Successful Response — `200 OK`

```json
{
  "message": "If an account exists for that email, a password-reset link has been sent."
}
```

The same generic response is returned whether or not the email address exists, helping prevent account enumeration.

### Rate Limit

Maximum **3 requests per IP address per hour**.

---

## 7.6 Reset Password

Resets a password using the token sent in the password-reset email.

### Endpoint

```http
PUT /api/auth/reset-password/:token
```

**Access:** Public

### Request Body

```json
{
  "password": "newpassword123"
}
```

### Requirements

The password must contain at least 6 characters.

### Successful Response — `200 OK`

The endpoint returns a new authentication response containing the user's details and a newly generated JWT.

### Possible Errors

- `400` — Missing or short password
- `400` — Reset token is invalid or expired

---

# 8. Public Endpoints

## 8.1 API Health Check

Checks whether the API is running.

### Endpoint

```http
GET /api/health
```

**Access:** Public

### Successful Response

```json
{
  "status": "ok",
  "environment": "production"
}
```

---

## 8.2 Public CivicFix Statistics

Returns live statistics used on the CivicFix homepage.

### Endpoint

```http
GET /api/public/stats
```

**Access:** Public

### Successful Response

```json
{
  "totalIssues": 250,
  "resolvedIssues": 135,
  "activeCitizens": 180
}
```

---

# 9. Category Endpoints

## 9.1 Get Public Categories

Returns all available issue categories.

### Endpoint

```http
GET /api/categories
```

**Access:** Public

### Successful Response

```json
[
  {
    "_id": "CATEGORY_ID",
    "name": "Road",
    "icon": "bi-sign-turn-slight-right",
    "createdAt": "2026-09-01T10:00:00.000Z",
    "updatedAt": "2026-09-01T10:00:00.000Z"
  }
]
```

---

# 10. Issue Endpoints

## 10.1 Get All Issues

Returns a filterable and paginated list of public issues.

### Endpoint

```http
GET /api/issues
```

**Access:** Public

### Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `category` | String | MongoDB category ID |
| `status` | String | Filter by issue status |
| `severity` | String | `Low`, `Medium`, `High`, or `Critical` |
| `search` | String | Searches issue title and description |
| `sortBy` | String | `newest`, `oldest`, `upvotes`, or `severity` |
| `page` | Number | Page number. Defaults to `1` |
| `limit` | Number | Results per page. Defaults to `10`, maximum `50` |

### Example

```http
GET /api/issues?status=Pending&severity=High&page=1&limit=10
```

### Successful Response

```json
{
  "issues": [],
  "total": 50,
  "page": 1,
  "pages": 5
}
```

Issue records are populated with:

- Category name and icon
- Reporter's name
- Assigned staff member's name

---

## 10.2 Create an Issue

Creates a new community issue report.

### Endpoint

```http
POST /api/issues
```

**Access:** Authenticated users

### Headers

```http
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Request Body

```json
{
  "title": "Large Pothole on Main Street",
  "description": "A large pothole is creating difficulties for motorists and pedestrians.",
  "category": "CATEGORY_ID",
  "severity": "High",
  "location": {
    "address": "Main Street, Ibadan",
    "latitude": 7.3775,
    "longitude": 3.947
  },
  "images": [
    "https://res.cloudinary.com/example/image/upload/example.jpg"
  ]
}
```

### Field Requirements

| Field | Type | Requirement |
|---|---|---|
| `title` | String | Required, maximum 200 characters |
| `description` | String | Required, maximum 2,000 characters |
| `category` | String | Required valid MongoDB ObjectId |
| `severity` | String | Required valid severity |
| `location.address` | String | Required |
| `location.latitude` | Number | Optional for a standard issue |
| `location.longitude` | Number | Optional for a standard issue |
| `images` | Array | Optional Cloudinary URLs |

Images are uploaded directly to Cloudinary before this endpoint is called.

### Successful Response — `201 Created`

Returns the newly created and populated issue.

---

## 10.3 Find Nearby Similar Issues

Checks for open issues in the same category near a specified geographical location.

### Endpoint

```http
GET /api/issues/nearby
```

**Access:** Public

### Required Query Parameters

| Parameter | Description |
|---|---|
| `latitude` | Latitude of the proposed issue |
| `longitude` | Longitude of the proposed issue |
| `category` | Category ID |

### Example

```http
GET /api/issues/nearby?latitude=7.3775&longitude=3.9470&category=CATEGORY_ID
```

The endpoint searches approximately within a 55-metre coordinate range and considers only:

- Pending
- Under Review
- Assigned
- In Progress

### Successful Response

```json
[
  {
    "_id": "ISSUE_ID",
    "issueId": "CF-2026-00001",
    "title": "Broken Streetlight",
    "status": "Pending",
    "upvoteCount": 14
  }
]
```

A maximum of 5 nearby issues is returned.

---

## 10.4 Get My Issues

Returns all issues reported by the authenticated user.

### Endpoint

```http
GET /api/issues/my-issues
```

**Access:** Authenticated users

### Successful Response

```json
{
  "summary": {
    "total": 12,
    "pending": 2,
    "inProgress": 3,
    "resolved": 6,
    "rejected": 1
  },
  "issues": []
}
```

---

## 10.5 Get a Single Issue

Returns detailed information about a specific issue and its comments.

### Endpoint

```http
GET /api/issues/:id
```

**Access:** Public

### Successful Response

```json
{
  "issue": {},
  "comments": []
}
```

The issue includes populated category, reporter, and assigned staff information.

### Possible Errors

- `404` — Invalid or nonexistent issue ID

---

## 10.6 Update an Issue

Updates an issue.

### Endpoint

```http
PUT /api/issues/:id
```

**Access:**

- The original reporter while the issue is still `Pending`
- An administrator

### Editable Fields

```json
{
  "title": "Updated issue title",
  "description": "Updated description",
  "category": "CATEGORY_ID",
  "severity": "Critical",
  "location": {
    "address": "Updated location",
    "latitude": 7.3775,
    "longitude": 3.947
  }
}
```

Administrators can additionally provide:

```json
{
  "status": "Under Review",
  "assignedTo": "STAFF_USER_ID"
}
```

### Possible Errors

- `403` — User is not permitted to edit the issue
- `404` — Issue not found

---

## 10.7 Delete an Issue

Deletes an issue and attempts to clean up associated comments and issue notifications.

### Endpoint

```http
DELETE /api/issues/:id
```

**Access:** Administrator only

### Successful Response

```json
{
  "message": "Issue CF-2026-00001 deleted successfully"
}
```

---

## 10.8 Toggle Community Upvote

Allows an authenticated user to indicate that they also experience a reported problem.

### Endpoint

```http
POST /api/issues/:id/upvote
```

**Access:** Authenticated users

Calling the endpoint again removes the user's existing upvote.

### Successful Response

```json
{
  "upvoteCount": 15,
  "upvoted": true
}
```

---

## 10.9 Get Issue Comments

Returns all comments for an issue in chronological order.

### Endpoint

```http
GET /api/issues/:id/comments
```

**Access:** Public

### Successful Response

```json
[
  {
    "_id": "COMMENT_ID",
    "issue": "ISSUE_ID",
    "user": {
      "_id": "USER_ID",
      "name": "John Doe",
      "role": "resident"
    },
    "text": "This problem is still affecting residents.",
    "createdAt": "2026-09-01T10:00:00.000Z"
  }
]
```

---

## 10.10 Add an Issue Comment

Adds a comment to an existing issue.

### Endpoint

```http
POST /api/issues/:id/comments
```

**Access:** Authenticated users

### Request Body

```json
{
  "text": "This issue has become worse after the recent rainfall."
}
```

### Successful Response — `201 Created`

Returns the created comment with the author populated.

---

## 10.11 Get Issue Audit Log

Returns the chronological status-change history for an issue.

### Endpoint

```http
GET /api/issues/:id/audit-log
```

**Access:** Public

### Successful Response

```json
[
  {
    "_id": "AUDIT_LOG_ID",
    "issue": "ISSUE_ID",
    "changedBy": {
      "_id": "USER_ID",
      "name": "Administrator",
      "role": "admin"
    },
    "fromStatus": "Pending",
    "toStatus": "Under Review",
    "createdAt": "2026-09-01T10:00:00.000Z"
  }
]
```

Rejections may include a `reason`.

---

# 11. Notification Endpoints

All notification endpoints require authentication.

## 11.1 Get My Notifications

Returns notifications for the authenticated user.

### Endpoint

```http
GET /api/notifications
```

### Query Parameters

| Parameter | Description |
|---|---|
| `page` | Page number |
| `unread` | Set to `true` to return only unread notifications |

### Example

```http
GET /api/notifications?page=1&unread=true
```

### Successful Response

```json
{
  "notifications": [],
  "unreadCount": 5,
  "total": 20,
  "page": 1,
  "pages": 2
}
```

The API uses a page size of 15 notifications.

---

## 11.2 Mark One Notification as Read

### Endpoint

```http
PUT /api/notifications/:id/read
```

**Access:** Notification owner only

### Successful Response

```json
{
  "message": "Marked as read",
  "_id": "NOTIFICATION_ID"
}
```

---

## 11.3 Mark All Notifications as Read

### Endpoint

```http
PUT /api/notifications/read-all
```

### Successful Response

```json
{
  "message": "All notifications marked as read",
  "modifiedCount": 5
}
```

---

# 12. Upload Endpoints

## 12.1 Get Cloudinary Upload Signature

Generates a server-signed payload for direct browser-to-Cloudinary uploads.

### Endpoint

```http
GET /api/uploads/signature
```

**Access:** Authenticated users

### Query Parameter

| Parameter | Allowed Values |
|---|---|
| `folder` | `civicfix/issues` |
| `folder` | `civicfix/emergency-reports` |

### Example

```http
GET /api/uploads/signature?folder=civicfix/issues
```

### Successful Response

```json
{
  "signature": "CLOUDINARY_SIGNATURE",
  "timestamp": 1788250000,
  "apiKey": "CLOUDINARY_API_KEY",
  "cloudName": "CLOUDINARY_CLOUD_NAME",
  "folder": "civicfix/issues"
}
```

This approach prevents large file uploads from passing through the backend server.

---

# 13. Push Notification Endpoints

## 13.1 Get VAPID Public Key

Returns the VAPID public key used by the browser to create a Push API subscription.

### Endpoint

```http
GET /api/push/vapid-public-key
```

**Access:** Public

### Successful Response

```json
{
  "publicKey": "VAPID_PUBLIC_KEY"
}
```

### Possible Error

- `503` — Push notifications are not configured on the server

---

## 13.2 Subscribe Device to Push Notifications

Saves a browser/device push subscription for the authenticated user.

### Endpoint

```http
POST /api/push/subscribe
```

**Access:** Authenticated users

### Request Body

```json
{
  "endpoint": "https://push-service.example/subscription-id",
  "keys": {
    "p256dh": "PUBLIC_KEY",
    "auth": "AUTH_SECRET"
  }
}
```

Duplicate endpoints are not stored more than once.

### Successful Response

```json
{
  "message": "Push subscription saved."
}
```

---

# 14. Staff Endpoints

All staff endpoints require:

- Valid JWT authentication
- `staff` role

## 14.1 Get My Assigned Issues

### Endpoint

```http
GET /api/staff/my-issues
```

### Successful Response

```json
{
  "summary": {
    "total": 10,
    "assigned": 3,
    "inProgress": 4,
    "resolved": 3
  },
  "issues": []
}
```

---

## 14.2 Advance Issue Progress

Moves an issue forward through the staff-controlled workflow.

### Endpoint

```http
PATCH /api/staff/issues/:id/progress
```

### Request Body

```json
{
  "note": "The maintenance team has started repairs."
}
```

### Status Transitions

```text
Assigned → In Progress
In Progress → Resolved
```

The API:

- Updates the issue status
- Notifies the original reporter
- Creates an audit-log entry
- Creates a visible progress comment when a note is supplied

### Successful Response

Returns the updated and populated issue.

---

## 14.3 Upload Resolution Proof

Uploads an after-image as evidence that an assigned issue has been addressed.

### Endpoint

```http
PATCH /api/staff/issues/:id/proof
```

**Content-Type:**

```text
multipart/form-data
```

### Form Field

| Field | Type | Description |
|---|---|---|
| `afterImage` | File | Resolution proof image |

The issue must be assigned to the authenticated staff member.

If the issue already contains an original image, the first image is automatically used as the `beforeImage` when one has not already been set.

### Successful Response

Returns the updated issue containing `beforeImage` and `afterImage` information.

---

# 15. Administrator Endpoints

All endpoints in this section require:

- Valid JWT authentication
- `admin` role

## 15.1 Get Dashboard Statistics

### Endpoint

```http
GET /api/admin/stats
```

### Successful Response

```json
{
  "totalReports": 250,
  "totalUsers": 180,
  "totalCategories": 8,
  "byStatus": {
    "pending": 20,
    "underReview": 30,
    "assigned": 25,
    "inProgress": 40,
    "resolved": 125,
    "rejected": 10
  }
}
```

---

## 15.2 Get Analytics

Returns aggregated data for administrator analytics and charts.

### Endpoint

```http
GET /api/admin/analytics
```

### Query Parameters

| Parameter | Description |
|---|---|
| `months` | Number of months to include, from 1 to 60. Defaults to 12. |

### Successful Response

The response includes:

- `byCategory`
- `resolutionRate`
- `byMonth`
- `topLocations`
- `months`
- `problemAreas`
- `avgResolutionTime`

Example:

```json
{
  "resolutionRate": "54.0%",
  "months": 12,
  "byCategory": [],
  "byMonth": [],
  "topLocations": [],
  "problemAreas": [],
  "avgResolutionTime": {
    "overall": 18.5,
    "byCategory": []
  }
}
```

---

## 15.3 Get All Users

### Endpoint

```http
GET /api/admin/users
```

Returns all users sorted by newest registration first. Passwords are excluded.

---

## 15.4 Update a User Role

### Endpoint

```http
PATCH /api/admin/users/:id/role
```

### Request Body

```json
{
  "role": "staff"
}
```

### Valid Roles

```text
resident
staff
admin
```

### Successful Response

```json
{
  "_id": "USER_ID",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "staff"
}
```

---

## 15.5 Delete a User

### Endpoint

```http
DELETE /api/admin/users/:id
```

Administrators cannot delete their own account through this endpoint.

### Successful Response

```json
{
  "message": "User \"John Doe\" deleted successfully"
}
```

---

## 15.6 Get Staff Workload

Returns all staff members and their current active issue counts.

### Endpoint

```http
GET /api/admin/staff-workload
```

Active issues are those with `Assigned` or `In Progress` status.

### Successful Response

```json
[
  {
    "_id": "STAFF_ID",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "activeCount": 3
  }
]
```

Results are sorted from the least-loaded staff member to the most-loaded.

---

## 15.7 Get All Categories for Administration

### Endpoint

```http
GET /api/admin/categories
```

Returns categories sorted alphabetically.

---

## 15.8 Create a Category

### Endpoint

```http
POST /api/admin/categories
```

### Request Body

```json
{
  "name": "Streetlight",
  "icon": "bi-lightbulb"
}
```

### Successful Response — `201 Created`

Returns the newly created category.

### Possible Errors

- `400` — Category name missing
- `409` — Category already exists

---

## 15.9 Update a Category

### Endpoint

```http
PUT /api/admin/categories/:id
```

### Request Body

```json
{
  "name": "Road Damage",
  "icon": "bi-cone-striped"
}
```

Only supplied fields are updated.

---

## 15.10 Delete a Category

### Endpoint

```http
DELETE /api/admin/categories/:id
```

A category cannot be deleted while issues still reference it.

### Possible Error

- `409` — One or more issues still reference the category

---

## 15.11 Assign an Issue to Staff

### Endpoint

```http
PATCH /api/admin/issues/:id/assign
```

### Request Body

```json
{
  "staffId": "STAFF_USER_ID"
}
```

The target user must exist and have the `staff` role.

The endpoint:

- Assigns the issue
- Changes its status to `Assigned`
- Creates an audit entry
- Notifies the issue reporter
- Notifies the assigned staff member

### Successful Response

Returns the updated and populated issue.

---

## 15.12 Update an Issue Status

Allows an administrator to directly update an issue status.

### Endpoint

```http
PATCH /api/admin/issues/:id/status
```

### Request Body

```json
{
  "status": "Under Review"
}
```

A rejection may include:

```json
{
  "status": "Rejected",
  "rejectionReason": "The report could not be verified."
}
```

### Valid Statuses

```text
Pending
Under Review
Assigned
In Progress
Resolved
Rejected
```

The status change is recorded in the issue audit log.

---

## 15.13 Bulk Assign Issues

Assigns multiple issues to one staff member.

### Endpoint

```http
POST /api/admin/issues/bulk-assign
```

### Request Body

```json
{
  "issueIds": [
    "ISSUE_ID_1",
    "ISSUE_ID_2"
  ],
  "staffId": "STAFF_USER_ID"
}
```

Resolved issues are skipped.

### Successful Response

```json
{
  "succeeded": [
    "ISSUE_ID_1"
  ],
  "skipped": [
    {
      "id": "ISSUE_ID_2",
      "reason": "already resolved"
    }
  ]
}
```

---

## 15.14 Bulk Reject Issues

Rejects multiple issues.

### Endpoint

```http
POST /api/admin/issues/bulk-reject
```

### Request Body

```json
{
  "issueIds": [
    "ISSUE_ID_1",
    "ISSUE_ID_2"
  ],
  "reason": "The submitted reports could not be verified."
}
```

Issues already marked as `Resolved` or `Rejected` are skipped.

### Successful Response

```json
{
  "succeeded": [
    "ISSUE_ID_1"
  ],
  "skipped": []
}
```

---

# 16. Emergency Reporting Endpoints

Emergency reports are intentionally separate from ordinary civic issues because they have stricter privacy, urgency, and lifecycle requirements.

## Emergency Report Lifecycle

```text
New
 ↓
Acknowledged
 ↓
Escalated
 ↓
Resolved
```

An administrator may also mark a report as:

```text
False Alarm
```

Emergency reports:

- Are never publicly listed
- Cannot be accessed by staff
- Are visible to their original reporter
- Are fully accessible to administrators

---

## 16.1 Get Emergency Number by Country

Returns verified emergency numbers for a supported country.

### Endpoint

```http
GET /api/emergency-reports/emergency-number
```

**Access:** Public

### Required Query Parameter

| Parameter | Description |
|---|---|
| `country` | Two-letter ISO 3166-1 alpha-2 country code |

### Example

```http
GET /api/emergency-reports/emergency-number?country=NG
```

### Successful Response

```json
{
  "found": true,
  "countryCode": "NG",
  "numbers": {},
  "lastVerified": "DATE"
}
```

### Not Found Response

```json
{
  "found": false,
  "countryCode": "XX",
  "message": "Emergency numbers for country code \"XX\" are not in the CivicFix dataset. Please dial your local emergency number."
}
```

---

## 16.2 Submit an Emergency Report

Creates a private emergency report.

### Endpoint

```http
POST /api/emergency-reports
```

**Access:** Authenticated users

### Request Body

```json
{
  "type": "Fire",
  "description": "A building is currently on fire.",
  "location": {
    "address": "Example Street, Ibadan",
    "latitude": 7.3775,
    "longitude": 3.947
  },
  "contactPhone": "+2348012345678",
  "media": [
    {
      "url": "https://res.cloudinary.com/example/video/upload/example.mp4",
      "type": "video",
      "durationSeconds": 12,
      "publicId": "civicfix/emergency-reports/example"
    }
  ]
}
```

### Valid Emergency Types

```text
Armed Robbery
Physical Assault / Violence
Domestic Violence
Fire
Medical Emergency
Kidnapping / Abduction
Active Threat
Other Life-Threatening Emergency
```

### Media Rules

- Maximum of 5 media files
- Allowed media types: `image` and `video`
- Videos must include a Cloudinary `publicId`
- Video duration is independently verified by the server
- The maximum permitted video duration is 15 seconds
- Invalid submissions attempt to clean up already uploaded Cloudinary assets

### Successful Response — `201 Created`

Returns the newly created emergency report with an initial status of `New`.

The API also triggers administrator notifications and web-push alerts.

---

## 16.3 Get My Emergency Reports

Returns emergency reports submitted by the authenticated user.

### Endpoint

```http
GET /api/emergency-reports/my-reports
```

**Access:** Authenticated users

Reports are returned newest first.

---

## 16.4 Get All Emergency Reports

Returns all emergency reports for administrative monitoring.

### Endpoint

```http
GET /api/emergency-reports
```

**Access:** Administrator only

Reports are prioritised in the following order:

```text
New
Acknowledged
Escalated
Resolved
False Alarm
```

Within each status, newer reports are shown first.

Reporter and acknowledgement information is populated where available.

---

## 16.5 Get a Single Emergency Report

### Endpoint

```http
GET /api/emergency-reports/:id
```

**Access:** Administrator only

Returns the complete report including:

- Emergency type
- Description
- Location
- Media
- Contact phone number, where provided
- Reporter details
- Acknowledgement information
- Status

---

## 16.6 Acknowledge an Emergency Report

Acknowledges a new emergency report.

### Endpoint

```http
PUT /api/emergency-reports/:id/acknowledge
```

**Access:** Administrator only

The endpoint:

- Changes `New` to `Acknowledged`
- Records the administrator who acknowledged it
- Records the acknowledgement timestamp

If the report has already moved beyond `New`, the endpoint returns a successful no-change response.

---

## 16.7 Update Emergency Report Status

Updates an emergency report to one of the administrator-controlled statuses.

### Endpoint

```http
PUT /api/emergency-reports/:id/status
```

**Access:** Administrator only

### Request Body

```json
{
  "status": "Escalated"
}
```

### Allowed Values

```text
Escalated
Resolved
False Alarm
```

`Acknowledged` must be set through the dedicated acknowledgement endpoint.

---

## 16.8 Get Emergency Statistics

Returns operational statistics for emergency monitoring.

### Endpoint

```http
GET /api/emergency-reports/stats
```

**Access:** Administrator only

### Successful Response

```json
{
  "avgAckMinutes": 4.5,
  "staleNewCount": 2,
  "byType": [
    {
      "type": "Fire",
      "count": 10
    }
  ]
}
```

`staleNewCount` represents reports that have remained in `New` status for more than 10 minutes.

---


# 17. Live Location Sharing Endpoints

Live Location Sharing is a dedicated personal-safety feature that allows an authenticated user to activate continuous location sharing during an emergency.

When a session starts, CivicFix automatically creates a linked private `EmergencyReport` with the type `Live Location SOS`. This reuses the existing emergency notification pipeline so administrators are alerted as soon as live sharing is activated.

The live-location system maintains:

- A current GPS position
- A chronological location trail
- Session start and expiry times
- Last successful location-ping time
- Explicit `active`, `ended`, or `expired` session status
- A linked private emergency report
- A resident-authored emergency note
- Silent admin-to-resident session messages
- A resident `"I'm Safe"` confirmation timestamp

### Live Location Session Lifecycle

```text
Active
  ├── Resident/Admin explicitly ends → Ended
  └── expiresAt is reached → Expired
```

> Session expiry is handled lazily on relevant reads/writes rather than by a background cron job. This suits the serverless deployment model.

### Safety and Privacy Contract

Live location sessions are treated as sensitive emergency data.

- Location pings can only be submitted by the session owner.
- A session can only be ended by its owner or an administrator.
- Session details and report-linked live-location data are administrator-accessible through the dedicated live-location endpoints.
- Emergency reports remain private and are not publicly listed or accessible to staff.
- Admin messages to a resident are deliberately **not** sent through Web Push or OS-level notifications. The resident client retrieves them through the session-message endpoint/ping response so the device does not make a sound, vibrate, or display a banner.
- The resident's `"I'm Safe"` action records a timestamp but **does not stop tracking or change the session status**. Only explicit `"Stop Sharing"` or administrator termination ends the session.

---

## 17.1 Start Live Location Sharing

Creates a new live-location session and its linked private emergency report.

### Endpoint

```http
POST /api/live-location/start
```

**Access:** Authenticated users

### Request Body

```json
{
  "durationMinutes": 60,
  "latitude": 7.3775,
  "longitude": 3.947,
  "accuracy": 12,
  "address": "Main Street, Ibadan"
}
```

### Fields

| Field | Type | Requirement |
|---|---|---|
| `durationMinutes` | Number | Optional; defaults to `60`; must be positive |
| `latitude` | Number | Required |
| `longitude` | Number | Required |
| `accuracy` | Number | Optional; device-reported accuracy in metres |
| `address` | String | Optional; defaults to `Live location — see map` |

### Server Behaviour

The endpoint:

1. Creates an `EmergencyReport` with type `Live Location SOS`.
2. Stores the initial GPS reading.
3. Creates a `LiveLocationSession` linked to the emergency report.
4. Sets `expiresAt` from the requested duration.
5. Sends the existing urgent emergency notification to administrators.
6. Returns identifiers needed by the client for subsequent location updates.

### Successful Response — `201 Created`

```json
{
  "message": "Live location session started",
  "sessionId": "SESSION_ID",
  "reportId": "EMERGENCY_REPORT_ID",
  "expiresAt": "2026-09-11T12:00:00.000Z"
}
```

### Possible Errors

- `400` — Latitude/longitude missing
- `400` — `durationMinutes` is not a positive number
- `500` — Server error starting the session

---

## 17.2 Record a Live Location Ping

Records the latest GPS position and appends it to the session's location trail.

### Endpoint

```http
POST /api/live-location/:id/ping
```

**Access:** Session owner only

### Request Body

```json
{
  "latitude": 7.3781,
  "longitude": 3.9478,
  "accuracy": 10,
  "lastSeenMessageAt": "2026-09-11T11:30:00.000Z"
}
```

### Fields

| Field | Type | Requirement |
|---|---|---|
| `latitude` | Number | Required |
| `longitude` | Number | Required |
| `accuracy` | Number | Optional |
| `lastSeenMessageAt` | ISO timestamp | Optional |

`lastSeenMessageAt` allows the resident client to receive only admin messages created after the supplied timestamp.

### Behaviour

Each accepted ping:

- Replaces `currentLocation` with the freshest GPS reading.
- Updates `lastPingAt`.
- Appends the reading to `locationTrail`.
- Returns any new admin session messages through the same response.

The location trail has a safety ceiling of **3,000 pings**. In normal operation, the full history is preserved for realistic session durations.

### Successful Response — `200 OK`

```json
{
  "message": "Ping recorded",
  "newMessages": []
}
```

If admin messages exist, they are returned in `newMessages`, oldest first, with the sender populated with `name` and `role`.

### Possible Errors

- `400` — Latitude/longitude missing
- `403` — Caller is not the session owner
- `404` — Session not found
- `410` — Session is ended or expired
- `500` — Server error recording the ping

---

## 17.3 End a Live Location Session

Explicitly terminates an active live-location session.

### Endpoint

```http
POST /api/live-location/:id/end
```

**Access:** Session owner or administrator

### Request Body

No body is required.

### Successful Response — `200 OK`

```json
{
  "message": "Session ended",
  "sessionId": "SESSION_ID"
}
```

The session is marked:

```text
status = "ended"
endedAt = current timestamp
```

The operation is idempotent, so a repeated request can safely set the session to `ended` again.

---

## 17.4 Get a Live Location Session

Returns a single live-location session for administrator monitoring.

### Endpoint

```http
GET /api/live-location/:id
```

**Access:** Administrator only

### Successful Response — `200 OK`

Returns the complete `LiveLocationSession` document with:

- Reporter name and email
- Linked emergency report details
- Current location
- Location trail
- Session status
- Start and expiry times
- Last ping time
- End time, when applicable
- `"I'm Safe"` confirmation timestamp, when applicable

For an active session whose `expiresAt` has passed, the API lazily changes its status to `expired` before returning it.

### Possible Errors

- `404` — Session not found
- `500` — Server error fetching the session

---

## 17.5 Get Live Location Session by Emergency Report

Retrieves the live-location session associated with a specific emergency report.

### Endpoint

```http
GET /api/live-location/by-report/:reportId
```

**Access:** Administrator only

### Successful Response — `200 OK`

When a session exists:

```json
{
  "session": {
    "_id": "SESSION_ID",
    "reporter": {},
    "emergencyReport": "EMERGENCY_REPORT_ID",
    "status": "active",
    "currentLocation": {},
    "locationTrail": [],
    "expiresAt": "2026-09-11T12:00:00.000Z"
  }
}
```

When no session exists:

```json
{
  "session": null
}
```

The endpoint returns the most recently created session linked to the report, regardless of whether its status is `active`, `ended`, or `expired`. Active sessions are lazily expired when necessary.

---

## 17.6 Add or Update a Live Location Emergency Note

Allows the session owner to provide a free-text description of what is happening.

### Endpoint

```http
PATCH /api/live-location/:id/note
```

**Access:** Session owner only

### Request Body

```json
{
  "note": "I am currently moving toward a safer location."
}
```

The note is stored in the linked `EmergencyReport`'s `description` field so administrators can see it alongside the live tracking information.

### Successful Response — `200 OK`

```json
{
  "message": "Note saved"
}
```

### Possible Errors

- `400` — Note is empty
- `403` — Caller is not the session owner
- `404` — Session not found

---

## 17.7 Send a Silent Admin Message to the Resident

Allows an administrator to send a one-way message to the resident who owns a live-location session.

### Endpoint

```http
POST /api/live-location/:id/messages
```

**Access:** Administrator only

### Request Body

```json
{
  "text": "We can see your location. Stay calm and keep moving if it is safe.",
  "isPreset": false
}
```

### Fields

| Field | Type | Requirement |
|---|---|---|
| `text` | String | Required and must not be empty |
| `isPreset` | Boolean | Optional; defaults to `false` |

### Important Safety Behaviour

This endpoint intentionally does **not** trigger Web Push or any OS-level notification.

Messages are delivered silently through client-side retrieval/polling and the location-ping response. This prevents sound, vibration, or notification banners from potentially exposing the resident during a dangerous situation.

### Successful Response — `201 Created`

```json
{
  "message": "Message sent",
  "data": {
    "_id": "MESSAGE_ID",
    "session": "SESSION_ID",
    "sender": "ADMIN_USER_ID",
    "text": "We can see your location.",
    "isPreset": false,
    "createdAt": "2026-09-11T11:30:00.000Z"
  }
}
```

---

## 17.8 Get Live Location Session Messages

Returns messages belonging to a live-location session in chronological order.

### Endpoint

```http
GET /api/live-location/:id/messages
```

**Access:** Session owner or administrator

### Successful Response — `200 OK`

```json
{
  "messages": [
    {
      "_id": "MESSAGE_ID",
      "session": "SESSION_ID",
      "sender": {
        "_id": "ADMIN_USER_ID",
        "name": "Administrator",
        "role": "admin"
      },
      "text": "We can see your location.",
      "isPreset": false,
      "createdAt": "2026-09-11T11:30:00.000Z"
    }
  ]
}
```

Messages are sorted from oldest to newest.

### Possible Errors

- `403` — Caller is neither the session owner nor an administrator
- `404` — Session not found

---

## 17.9 Confirm "I'm Safe"

Records the resident's `"I'm Safe"` confirmation.

### Endpoint

```http
POST /api/live-location/:id/confirm-safe
```

**Access:** Session owner only

### Request Body

No body is required.

### Successful Response — `200 OK`

```json
{
  "message": "Confirmation recorded",
  "reporterConfirmedSafeAt": "2026-09-11T11:35:00.000Z",
  "sessionStatus": "active"
}
```

### Critical Safety Invariant

The endpoint **does not**:

- End the session
- Change `session.status`
- Stop GPS tracking

The confirmation is informational only. It records that the resident acknowledged the situation and sends an **in-app, normal-priority notification to administrators**.

The resident must explicitly use the session end action to stop sharing.

### Possible Errors

- `403` — Caller is not the session owner
- `404` — Session not found

---

# 18. HTTP Status Codes

| Status Code | Meaning | CivicFix Usage |
|---|---|---|
| `200 OK` | Request successful | Successful reads and updates |
| `201 Created` | Resource created | Registration, issue creation, comments, categories, emergency reports and live-location sessions/messages |
| `400 Bad Request` | Invalid request | Missing or invalid data |
| `401 Unauthorized` | Authentication failed | Missing, invalid or expired JWT |
| `403 Forbidden` | Permission denied | User does not have the required role or resource ownership |
| `404 Not Found` | Resource does not exist | Invalid or missing issue, user, notification, report or live-location session |
| `409 Conflict` | Resource conflict | Duplicate user/category or category still in use |
| `423 Locked` | Account temporarily locked | Too many failed login attempts |
| `429 Too Many Requests` | Rate limit exceeded | Excessive login or password-reset attempts |
| `410 Gone` | Session no longer active | Live-location session has ended or expired and cannot accept pings |
| `500 Internal Server Error` | Unexpected server failure | Unhandled backend errors |
| `503 Service Unavailable` | Service feature unavailable | Push notifications not configured |

---

# 19. Core Data Models

## 18.1 User

```text
User
├── name
├── email
├── password
├── role
├── location
├── failedLoginAttempts
├── lockUntil
├── resetPasswordToken
├── resetPasswordExpire
├── pushSubscriptions
├── createdAt
└── updatedAt
```

### Roles

```text
resident
admin
staff
```

Passwords are hashed with `bcryptjs` before being stored.

---

## 18.2 Issue

```text
Issue
├── issueId
├── title
├── description
├── category
├── location
│   ├── address
│   ├── latitude
│   └── longitude
├── images
├── severity
├── status
├── reportedBy
├── assignedTo
├── upvotes
├── beforeImage
├── afterImage
├── rejectionReason
├── createdAt
└── updatedAt
```

CivicFix generates human-readable issue identifiers in the following format:

```text
CF-YYYY-00001
```

Example:

```text
CF-2026-00001
```

---

## 18.3 Category

```text
Category
├── name
├── icon
├── createdAt
└── updatedAt
```

The `icon` field stores a Bootstrap Icons class name.

---

## 18.4 Comment

```text
Comment
├── issue
├── user
├── text
├── createdAt
└── updatedAt
```

---

## 18.5 Notification

```text
Notification
├── recipient
├── issue
├── emergencyReport
├── message
├── read
├── priority
├── category
├── createdAt
└── updatedAt
```

Notification priority can be:

```text
normal
urgent
```

Notification category can be:

```text
issue
emergency
```

---

## 18.6 Audit Log

```text
AuditLog
├── issue
├── changedBy
├── fromStatus
├── toStatus
├── reason
├── createdAt
└── updatedAt
```

Audit logs provide a chronological record of issue status changes.

---

## 18.7 Emergency Report

```text
EmergencyReport
├── reporter
├── type
├── description
├── location
│   ├── address
│   ├── latitude
│   └── longitude
├── media
│   ├── url
│   ├── type
│   ├── durationSeconds
│   └── publicId
├── contactPhone
├── status
├── acknowledgedBy
├── acknowledgedAt
├── createdAt
└── updatedAt
```

---


## 18.8 LiveLocationSession

```text
LiveLocationSession
├── reporter
├── emergencyReport
├── status
├── startedAt
├── expiresAt
├── endedAt
├── currentLocation
│   ├── latitude
│   ├── longitude
│   ├── accuracy
│   └── timestamp
├── locationTrail[]
│   ├── latitude
│   ├── longitude
│   ├── accuracy
│   └── timestamp
├── lastPingAt
├── reporterConfirmedSafeAt
├── createdAt
└── updatedAt
```

### Session Statuses

```text
active
ended
expired
```

`locationTrail` is capped at 3,000 entries by the live-location controller. `expiresAt` is required so every session has a finite lifetime.

---

## 18.9 SessionMessage

```text
SessionMessage
├── session
├── sender
├── text
├── isPreset
├── createdAt
└── updatedAt
```

`sender` is an administrator. Messages are sorted chronologically and delivered silently to the resident through application-level retrieval rather than OS-level push notifications.

# 20. Security and Validation Features

The CivicFix API implements several security and reliability measures.

## Password Security

User passwords are hashed with `bcryptjs` before storage.

## JWT Authentication

Private routes require a valid Bearer token.

## Role-Based Authorization

Administrative and staff routes enforce user-role permissions.

## Login Rate Limiting

The API limits login attempts to help reduce brute-force attacks.

## Account Lockout

Repeated unsuccessful login attempts can temporarily lock an account.

## Password Reset Security

Password reset tokens are generated cryptographically and only their SHA-256 hashes are stored in the database.

## Password Reset Privacy

The API returns a generic response for password-reset requests, preventing attackers from discovering which email addresses are registered.

## Input Validation

Key registration, login, and issue-creation requests use `express-validator`.

## Security Headers

CivicFix uses `Helmet` to apply security-related HTTP headers.

## CORS Protection

The API restricts browser origins to configured client origins.

## Media Upload Security

Issue and emergency media are uploaded directly to Cloudinary. The backend generates signed upload parameters and validates allowed folders.

## Emergency Video Verification

Emergency video duration is verified independently through Cloudinary's server-side API rather than trusting client-supplied metadata.

## Live Location Safety Controls

Live location access is restricted by session ownership and administrator privileges. Session expiry is checked lazily on relevant reads and writes, and location history is bounded to prevent unbounded document growth.

Admin-to-resident live-session messages deliberately bypass push/system notifications and are delivered through silent application-level retrieval. The resident's `reporterConfirmedSafeAt` timestamp never changes the session lifecycle.

## Authorization Ownership Checks

The API verifies resource ownership where required, including:

- Editing a resident's pending issue
- Marking a notification as read
- Updating an assigned staff issue
- Accessing private emergency reports

---

# Appendix: Complete Endpoint Summary

| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/health` | Public |
| GET | `/api/public/stats` | Public |
| POST | `/api/auth/register` | Public |
| POST | `/api/auth/login` | Public |
| GET | `/api/auth/me` | Authenticated |
| POST | `/api/auth/logout` | Authenticated |
| POST | `/api/auth/forgot-password` | Public |
| PUT | `/api/auth/reset-password/:token` | Public |
| GET | `/api/categories` | Public |
| GET | `/api/issues` | Public |
| POST | `/api/issues` | Authenticated |
| GET | `/api/issues/nearby` | Public |
| GET | `/api/issues/my-issues` | Authenticated |
| GET | `/api/issues/:id` | Public |
| PUT | `/api/issues/:id` | Reporter/Admin |
| DELETE | `/api/issues/:id` | Admin |
| POST | `/api/issues/:id/upvote` | Authenticated |
| GET | `/api/issues/:id/comments` | Public |
| POST | `/api/issues/:id/comments` | Authenticated |
| GET | `/api/issues/:id/audit-log` | Public |
| GET | `/api/notifications` | Authenticated |
| PUT | `/api/notifications/read-all` | Authenticated |
| PUT | `/api/notifications/:id/read` | Authenticated |
| GET | `/api/uploads/signature` | Authenticated |
| GET | `/api/push/vapid-public-key` | Public |
| POST | `/api/push/subscribe` | Authenticated |
| GET | `/api/staff/my-issues` | Staff |
| PATCH | `/api/staff/issues/:id/progress` | Staff |
| PATCH | `/api/staff/issues/:id/proof` | Staff |
| GET | `/api/admin/stats` | Admin |
| GET | `/api/admin/analytics` | Admin |
| GET | `/api/admin/users` | Admin |
| PATCH | `/api/admin/users/:id/role` | Admin |
| DELETE | `/api/admin/users/:id` | Admin |
| GET | `/api/admin/staff-workload` | Admin |
| GET | `/api/admin/categories` | Admin |
| POST | `/api/admin/categories` | Admin |
| PUT | `/api/admin/categories/:id` | Admin |
| DELETE | `/api/admin/categories/:id` | Admin |
| POST | `/api/admin/issues/bulk-assign` | Admin |
| POST | `/api/admin/issues/bulk-reject` | Admin |
| PATCH | `/api/admin/issues/:id/assign` | Admin |
| PATCH | `/api/admin/issues/:id/status` | Admin |
| POST | `/api/live-location/start` | Authenticated |
| POST | `/api/live-location/:id/ping` | Session Owner |
| POST | `/api/live-location/:id/end` | Session Owner/Admin |
| GET | `/api/live-location/:id` | Admin |
| GET | `/api/live-location/by-report/:reportId` | Admin |
| PATCH | `/api/live-location/:id/note` | Session Owner |
| POST | `/api/live-location/:id/messages` | Admin |
| GET | `/api/live-location/:id/messages` | Session Owner/Admin |
| POST | `/api/live-location/:id/confirm-safe` | Session Owner |
| GET | `/api/emergency-reports/emergency-number` | Public |
| POST | `/api/emergency-reports` | Authenticated |
| GET | `/api/emergency-reports/my-reports` | Authenticated |
| GET | `/api/emergency-reports/stats` | Admin |
| GET | `/api/emergency-reports` | Admin |
| GET | `/api/emergency-reports/:id` | Admin |
| PUT | `/api/emergency-reports/:id/acknowledge` | Admin |
| PUT | `/api/emergency-reports/:id/status` | Admin |

---

