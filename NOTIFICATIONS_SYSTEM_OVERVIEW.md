# Rocket.Chat Notifications System Architecture

## Overview
Rocket.Chat implements a multi-channel notification system supporting push notifications (iOS/Android), email notifications, desktop notifications, and in-app notification banners. The system is built on a queue-based architecture with scheduling capabilities based on user online status.

---

## 1. PUSH NOTIFICATIONS SYSTEM (Mobile)

### Core Files
- `/home/user/Rocket.Chat/apps/meteor/app/push/server/push.ts` - Main push notification class
- `/home/user/Rocket.Chat/apps/meteor/app/push/server/apn.ts` - Apple Push Notification (APNs) handler
- `/home/user/Rocket.Chat/apps/meteor/app/push/server/gcm.ts` - Google Cloud Messaging (GCM/FCM) handler
- `/home/user/Rocket.Chat/apps/meteor/app/push/server/definition.ts` - Type definitions

### How It Works

#### Push Token Registration
Tokens are registered via the Meteor method `raix:push-update`:
- **File**: `/home/user/Rocket.Chat/apps/meteor/app/push/server/methods.ts`
- Tokens stored in `_raix_push_app_tokens` collection
- Each token record contains:
  - `token`: { apn: string } or { gcm: string }
  - `authToken`: hashed login token
  - `appName`: application identifier
  - `userId`: user ID
  - `metadata`: additional device info
  - `enabled`: boolean
  - `createdAt/updatedAt`: timestamps

#### Push Gateway Support
- Server can use **native push** (direct APNs/GCM integration) or **cloud gateway**
- Cloud gateway: `https://gateway.rocket.chat` (when `Push_enable_gateway=true`)
- Settings: `/home/user/Rocket.Chat/apps/meteor/server/settings/push.ts`

#### Native Push Configuration
**File**: `/home/user/Rocket.Chat/apps/meteor/server/lib/pushConfig.ts`
- APNs Configuration:
  - Production gateway: `gateway.push.apple.com`
  - Sandbox gateway: `gateway.sandbox.push.apple.com`
  - Certificates: PEM format (cert, key, passphrase)
- GCM/FCM Configuration:
  - API Key: `Push_gcm_api_key`
  - Project Number: `Push_gcm_project_number`

### APNs Implementation Details
- **File**: `/home/user/Rocket.Chat/apps/meteor/app/push/server/apn.ts`
- Uses `apn` npm package
- Features:
  - Badge count support
  - Sound notifications
  - Custom categories (iOS interactive notifications)
  - Payload support with custom data
  - Thread ID support (notId)
  - Priority setting (1-10)
  - Mutable content flag for notification extensions
  - Expiry: 1 hour from send time
- Error Handling:
  - Status 400/410: Remove invalid token
  - Status 422: Reject notification (no retry)

### GCM/FCM Implementation Details
- **File**: `/home/user/Rocket.Chat/apps/meteor/app/push/server/gcm.ts`
- Uses `node-gcm` npm package
- Features:
  - Collapse key (prevents duplicate notifications)
  - High priority delivery (respects Doze mode)
  - Supports up to 5 retry attempts
  - Badge count as `msgcnt`
  - Custom image support
  - Style support (inbox style)
- Error Handling:
  - Canonical IDs: Auto-refresh token if device returns new token
  - Failure: Remove invalid token

### Push Notification Sending
**File**: `/home/user/Rocket.Chat/apps/meteor/app/push/server/push.ts`

Main flow:
1. `Push.configure()` - Initialize with APNs/GCM credentials
2. `Push.send(options)` - Send notification
   - Validates notification data
   - Queries AppsTokens collection for user's devices
   - Routes to gateway or native push
   - Tracks sent count (APNs vs GCM)
3. Gateway retry logic: Exponential backoff [1, 2, 4, 8, 16] minutes

#### PushNotification Helper
- **File**: `/home/user/Rocket.Chat/apps/meteor/app/push-notifications/server/lib/PushNotification.ts`
- Generates notification configs from message data
- Hash function for notification IDs: `hash(serverId|roomId)`
- Features:
  - Message content omitting (setting: `Push_request_content_from_server`)
  - Username display control
  - Badge count from subscription
  - Reply category (MESSAGE vs MESSAGE_NOREPLY based on room permissions)

---

## 2. EMAIL NOTIFICATION SYSTEM

### Core Files
- `/home/user/Rocket.Chat/apps/meteor/app/lib/server/functions/notifications/email.js`
- Uses Mailer API: `/home/user/Rocket.Chat/apps/meteor/app/mailer/server/api`

### Email Notification Flow

#### Decision Logic
**Function**: `shouldNotifyEmail()` - Determines if email should be sent

Conditions (all must be true):
- Email notifications globally enabled: `Accounts_AllowEmailNotifications`
- User email preference NOT 'nothing'
- User offline (`statusConnection !== 'online'`)
- One of:
  - Direct message (roomType === 'd')
  - Message is highlighted
  - User mentioned (@username)
  - @all mentioned (if not disableAllMessageNotifications)
  - Reply to thread (if not in thread)

#### Email Content Generation
**Function**: `getEmailData()` - Creates email object

Content includes:
- Subject: Dynamic (mention vs direct message vs group)
- Body: Message content (if `Email_notification_show_message=true`)
- File notifications: Shows file name and description
- Attachments: Shows first attachment
- Sender info, room name, links
- Footer with "Go to message" button
- Optional: Direct reply headers (if `Direct_Reply_Enable=true`)

Features:
- Real name usage (if `UI_Use_Real_Name=true`)
- HTML templates with inline CSS
- Encrypted message handling
- Deep linking support
- Custom footer templates

### Email Sending
**Function**: `sendEmailFromData()`
- Delegates to Mailer.send()
- Metrics tracking: `metrics.notificationsSent.inc()`

---

## 3. DESKTOP NOTIFICATIONS

### Core Files
- `/home/user/Rocket.Chat/apps/meteor/app/lib/server/functions/notifications/desktop.ts`
- Client handler: `/home/user/Rocket.Chat/apps/meteor/app/ui/client/lib/KonchatNotification.ts`

### Desktop Notification Decision
**Function**: `shouldNotifyDesktop()`

Conditions (all must be true):
- NOT all disabled AND NOT in desktop notification preference=nothing
- User NOT offline AND NOT busy status
- One of:
  - Direct message
  - User mentioned (@username)
  - @here/@all mentioned (if not disableAllMessageNotifications)
  - Highlighted message
  - Desktop preference='all'
- If thread: reply must be in thread

### Server-Side Desktop Notification
**Function**: `notifyDesktopUser()`
- Uses API broadcast: `api.broadcast('notify.desktop', userId, payload)`
- Payload includes:
  - Title, text, duration
  - Message metadata (id, rid, tmid)
  - Sender info
  - Room type and name

### Client-Side Desktop Notification Handling
**File**: `/home/user/Rocket.Chat/apps/meteor/app/ui/client/lib/KonchatNotification.ts`

Features:
- Requests browser permission: `Notification.requestPermission()`
- Creates native browser notifications
- Auto-close after duration (if not `requireInteraction`)
- Click handlers: Navigate to room/message
- Reply support (Notification API `canReply`)
- Silent mode: No system sound
- Tag: Message ID (groups notifications)
- Icon: Sender avatar URL
- Body: Message text with HTML tags stripped

---

## 4. NOTIFICATION QUEUE & SCHEDULING

### Core Files
- `/home/user/Rocket.Chat/apps/meteor/app/notification-queue/server/NotificationQueue.ts` - Queue worker
- `/home/user/Rocket.Chat/apps/meteor/server/models/raw/NotificationQueue.ts` - Database model
- Database collection: `notification_queue`

### Queue Worker Architecture

**Queue Items Structure**:
```typescript
interface INotification {
  _id: string;
  uid: string;              // user ID
  rid: string;              // room ID
  mid: string;              // message ID
  ts: Date;                 // timestamp
  schedule?: Date;          // when to send
  sending?: Date;           // when worker started processing
  error?: string;           // error message if failed
  items: NotificationItem[]; // push or email items
}

type NotificationItem = INotificationItemPush | INotificationItemEmail;
```

### Queue Scheduling

**Delay Logic** - Based on user `statusConnection`:
- `online`: 120 seconds delay (batch nearby notifications)
- `away`: 0 seconds (send immediately)
- `offline`: 0 seconds (send immediately)

Environment variables:
- `NOTIFICATIONS_WORKER_TIMEOUT`: 2000ms (cycle interval)
- `NOTIFICATIONS_BATCH_SIZE`: 100 (max items per cycle)
- `NOTIFICATIONS_SCHEDULE_DELAY_*`: Override defaults

### Queue Worker Processing

**File**: `/home/user/Rocket.Chat/app/notification-queue/server/NotificationQueue.ts`

Process:
1. `worker()` - Main processing loop
2. `getNextNotification()` - Fetch next queued item
3. For each item in notification:
   - `type: 'push'` → `PushNotification.send()`
   - `type: 'email'` → `sendEmailFromData()`
4. Error handling: Sets error field, retries after expiry (5 minutes)
5. Removes item on success
6. Batch processing: Continues until batch limit reached

### Queue Database Methods
- `findNextInQueueOrExpired()` - Fetch and lock next item
- `unsetSendingById()` - Release lock
- `setErrorById()` - Record error
- `clearScheduleByUserId()` - Remove schedule when user comes online
- `clearQueueByUserId()` - Clear all items for user

### TTL Index
- Auto-deletes notifications older than 2 hours
- Sparse index on `schedule` field

---

## 5. IN-APP NOTIFICATION BANNERS/TOASTS

### Client-Side Implementation
**File**: `/home/user/Rocket.Chat/apps/meteor/client/startup/notifications/notification.ts`

Handles:
- Audio notifications based on user preferences
- New room sound: `newRoomNotification` preference
- Volume control: `notificationsSoundVolume` (0-100)
- Uses CustomSounds library for playback

### Notification Stream
**File**: `/home/user/Rocket.Chat/apps/meteor/server/modules/notifications/notifications.module.ts`

Stream Configuration:
- `notify-all`: Public stream for all users
- `notify-logged`: For authenticated users
- `notify-room`: Room-specific notifications
- `notify-user`: User-specific notifications
- `notify-room-users`: Multi-user notifications
- Integration with Streamer for real-time delivery

---

## 6. NOTIFICATION PREFERENCES & SETTINGS

### Core Files
- `/home/user/Rocket.Chat/apps/meteor/app/push-notifications/server/methods/saveNotificationSettings.ts`
- Server settings: `/home/user/Rocket.Chat/apps/meteor/server/settings/push.ts`

### Subscription-Level Preferences

**Settings Updated by**: `saveNotificationSettings()` Meteor method

Fields in Subscriptions collection:
1. `desktopNotifications`: 'all' | 'mentions' | 'nothing'
2. `mobilePushNotifications`: 'all' | 'mentions' | 'nothing'
3. `emailNotifications`: 'all' | 'mentions' | 'nothing'
4. `unreadAlert`: true/false
5. `disableNotifications`: true/false
6. `hideUnreadStatus`: true/false
7. `hideMentionStatus`: true/false
8. `muteGroupMentions`: true/false (suppress @here/@all)
9. `audioNotificationValue`: sound file (or 'default')

**Origin Tracking**:
- `desktopPrefOrigin`: 'user' | 'server'
- `mobilePrefOrigin`: 'user' | 'server'
- `emailPrefOrigin`: 'user' | 'server'

### Server Default Preferences
Settings in `_settings` collection:

**Desktop**: `Accounts_Default_User_Preferences_desktopNotifications`
**Mobile**: `Accounts_Default_User_Preferences_pushNotifications`
**Email**: `Accounts_Default_User_Preferences_emailNotificationMode`

### Notification Preference Helper
**File**: `/home/user/Rocket.Chat/apps/meteor/app/utils/server/getUserNotificationPreference`

Resolves preference hierarchy:
1. Subscription-level preference (if origin='user')
2. Server defaults

---

## 7. NOTIFICATION TRIGGERS

### Main Trigger Point
**File**: `/home/user/Rocket.Chat/apps/meteor/app/lib/server/lib/sendNotificationsOnMessage.ts`

Callback: `afterSaveMessage` (priority: LOW)
- Function: `sendAllNotifications(message, room)`

### Mention Detection
**File**: `/home/user/Rocket.Chat/apps/meteor/app/lib/server/lib/notifyUsersOnMessage.ts`

Mention parsing:
- `getMentions()` - Parse @mentions from message
- Returns:
  - `toAll`: boolean (found @all)
  - `toHere`: boolean (found @here)
  - `mentionIds`: string[] (user IDs mentioned)
- Handles team mentions (passed to callbacks)

### Highlight Detection
**Function**: `messageContainsHighlight()`
- Compares against user's custom highlights
- Case-insensitive regex matching

### Thread Mentions
- Tracked via `message.tmid` (thread ID)
- Users in thread tracked in `usersInThread` array
- Thread replies trigger notifications for followers

### Notification Decision Matrix

For each eligible recipient, check in order:

**Desktop**:
- All: DMs, @mentions, @all/@here, highlights, desktop pref='all'
- Mentions: User mentioned, @all/@here
- Thread: Only if reply in thread

**Mobile Push**:
- All: DMs, @mentions, @all/@here, highlights, mobile pref='all'
- Mentions: User mentioned
- Thread: Only if reply in thread
- Special: Skip if video conference ringing enabled

**Email**:
- All: DMs, @mentions, @all/@here, highlights, email pref='all'
- Mentions: User mentioned
- Conditions: User offline, verified email
- Thread: Only if reply in thread

### Exclusions
- Don't notify sender
- Don't notify if room disabled notifications globally
- Don't notify if subscription `disableNotifications=true`
- Don't notify if subscription `ignored` includes sender
- Respect `muteGroupMentions` (suppress @all/@here unless directly mentioned)
- Check room member limits: `Notifications_Max_Room_Members`

### Unread Count Management
**File**: `/home/user/Rocket.Chat/apps/meteor/app/lib/server/lib/notifyUsersOnMessage.ts`

Functions in Subscriptions model:
- `incUnreadForRoomIdExcludingUserIds()` - Increment all messages
- `incUserMentionsAndUnreadForRoomIdAndUserIds()` - User mention + unread
- `incGroupMentionsAndUnreadForRoomIdExcludingUserId()` - Group mention + unread

Unread count setting: `Unread_Count` (all/mentions/dm-only) per room type

---

## 8. PUSH TOKEN MANAGEMENT

### Token Storage
Collection: `_raix_push_app_tokens` (APpsTokens model)

**Indexes**:
- { userId: 1, authToken: 1 }
- { appName: 1, token: 1 }

### Token Registration Endpoints

#### Method: `raix:push-update`
**File**: `/home/user/Rocket.Chat/apps/meteor/app/push/server/methods.ts`

Params:
- `id`: Optional device ID
- `token`: { apn: string } or { gcm: string }
- `authToken`: Hashed login token
- `appName`: Application name
- `userId`: Optional user ID
- `metadata`: Device metadata

Logic:
1. Hash auth token
2. Find existing token by id, userId, or token+appName
3. If not found: Create new record
4. If found: Update token and timestamp
5. Deduplicate: Remove older records with same token+appName

#### REST API: `POST /api/v1/push.token`
**File**: `/home/user/Rocket.Chat/apps/meteor/app/api/server/v1/push.ts`

Params:
- `id`: Optional device ID
- `type`: 'apn' or 'gcm'
- `value`: Token string
- `appName`: Application name

Returns: Token record

#### REST API: `DELETE /api/v1/push.token`
Params:
- `token`: Token string

Deletes all matching tokens for current user

### Token Cleanup
**File**: `/home/user/Rocket.Chat/apps/meteor/server/services/push/service.ts`

PushService watches user events:
- On login token changes: `removeByUserIdExceptTokens()`
- On logout: `removeAllByUserId()`
- Keeps only active hashed tokens

### Token Validation
Failed push attempts trigger removal:
- APNs: Status 400 or 410 → Remove token
- GCM: Failure flag → Remove token
- GCM: Canonical ID → Replace with new token

---

## 9. PUSH GATEWAY INTEGRATION

### Gateway Architecture
**Setting**: `Push_enable_gateway` (boolean)
**URL**: `Push_gateway` (default: `https://gateway.rocket.chat`)

### When Gateway is Used
Conditions (all required):
1. `Push_enable_gateway=true`
2. `Register_Server=true`
3. `Cloud_Service_Agree_PrivacyTerms=true`

### Gateway Communication
**File**: `/home/user/Rocket.Chat/apps/meteor/app/push/server/push.ts`

Method: `sendGatewayPush()`
- Sends to: `{gateway}/push/{service}/send`
- Services: 'apn' or 'gcm'
- Auth: Bearer token (workspace access token)

Request body:
```json
{
  "token": "device-token",
  "options": {
    "uniqueId": "server-id",
    "from": "push",
    "title": "...",
    "text": "...",
    "badge": 1,
    "sound": "default",
    "payload": {...},
    "apn": {...},
    "gcm": {...}
  }
}
```

### Gateway Response Handling
- 200: Success
- 406: Invalid token → Remove from AppsTokens
- 422: Gateway rejected → No retry
- 401: Unauthorized → Log warning, no retry
- Other: Retry with exponential backoff (max 5 times)

---

## 10. NOTIFICATION DEDUPLICATION & BATCHING

### Deduplication Strategies

#### Device-Level
- APNs: Each device gets one notification (native deduplication)
- GCM: Collapse key = `notification.from` (room ID)
  - Groups messages from same room into one notification

#### Queue-Level
- No built-in deduplication in queue
- Relies on upstream logic (message callbacks)

#### User-Level
- Schedule clearing: When user comes online, clear pending scheduled items
- `clearScheduleByUserId()` - Prevents notification barrage

### Batching

#### Temporal Batching
Queue scheduling by status:
- Online users: 120 second delay (batches notifications)
- Away/Offline: Immediate dispatch

#### Worker Batching
- Processes up to 100 items per cycle (configurable)
- Cycle interval: 2000ms

#### Push Data Batching
- GCM: Can send to multiple tokens in single call
- File: `/home/user/Rocket.Chat/apps/meteor/app/push/server/gcm.ts`
- Loop iterates over userTokens array

---

## 11. UNREAD COUNT MANAGEMENT

### Badge Count Calculation
**File**: `/home/user/Rocket.Chat/apps/meteor/server/models/raw/Subscriptions.ts`

Method: `getBadgeCount(uid: string)`
- Aggregates `unread` field across all subscriptions
- Excludes archived rooms
- Used for mobile badge display

### Subscription Unread Fields
- `unread`: Number of unread messages
- `userMentions`: Count of @mentions
- `groupMentions`: Count of @all/@here mentions

### Unread Count Settings
Per room type (subscription field `t`):
- Direct Messages: `Unread_Count_DM` (all/mentions)
- Omnichannel: `Unread_Count_Omni` (all/mentions)
- Channels/Groups: `Unread_Count` (all/mentions/dm)

Values:
- 'all_messages': Count all
- 'user_mentions_only': Count only @user mentions
- 'group_mentions_only': Count only @all/@here
- 'user_and_group_mentions_only': Count both mention types

### Mark as Read/Unread
Methods in Subscriptions:
- `setOpenForRoomIdExcludingUserId()` - Mark room open (read)
- `setAlertForRoomIdExcludingUserId()` - Mark room alert (has unread)
- `setLastReplyForRoomIdAndUserIds()` - Update thread reply tracking

---

## FILE REFERENCES SUMMARY

### Push Notifications
1. `/home/user/Rocket.Chat/apps/meteor/app/push/server/push.ts` - Main push class
2. `/home/user/Rocket.Chat/apps/meteor/app/push/server/apn.ts` - APNs handler
3. `/home/user/Rocket.Chat/apps/meteor/app/push/server/gcm.ts` - GCM/FCM handler
4. `/home/user/Rocket.Chat/apps/meteor/app/push/server/methods.ts` - Token registration
5. `/home/user/Rocket.Chat/apps/meteor/app/push/server/definition.ts` - Type definitions
6. `/home/user/Rocket.Chat/apps/meteor/app/push-notifications/server/lib/PushNotification.ts` - Push helper
7. `/home/user/Rocket.Chat/apps/meteor/server/lib/pushConfig.ts` - Configuration

### Email Notifications
8. `/home/user/Rocket.Chat/apps/meteor/app/lib/server/functions/notifications/email.js` - Email logic

### Desktop Notifications
9. `/home/user/Rocket.Chat/apps/meteor/app/lib/server/functions/notifications/desktop.ts` - Server-side
10. `/home/user/Rocket.Chat/apps/meteor/app/ui/client/lib/KonchatNotification.ts` - Client-side

### Notification Queue
11. `/home/user/Rocket.Chat/apps/meteor/app/notification-queue/server/NotificationQueue.ts` - Worker
12. `/home/user/Rocket.Chat/apps/meteor/server/models/raw/NotificationQueue.ts` - Database model
13. `/home/user/Rocket.Chat/apps/meteor/server/models/NotificationQueue.ts` - Model wrapper

### Message Notification Triggers
14. `/home/user/Rocket.Chat/apps/meteor/app/lib/server/lib/sendNotificationsOnMessage.ts` - Main trigger
15. `/home/user/Rocket.Chat/apps/meteor/app/lib/server/lib/notifyUsersOnMessage.ts` - Unread/mention tracking
16. `/home/user/Rocket.Chat/apps/meteor/app/lib/server/functions/notifications/mobile.js` - Mobile decision logic
17. `/home/user/Rocket.Chat/apps/meteor/app/lib/server/functions/notifications/index.ts` - Utilities

### Preferences & Settings
18. `/home/user/Rocket.Chat/apps/meteor/app/push-notifications/server/methods/saveNotificationSettings.ts` - Settings save
19. `/home/user/Rocket.Chat/apps/meteor/server/settings/push.ts` - Push settings definitions
20. `/home/user/Rocket.Chat/apps/meteor/app/utils/server/getUserNotificationPreference` - Preference resolution

### Models & Data
21. `/home/user/Rocket.Chat/apps/meteor/server/models/raw/AppsTokens.ts` - Push token model
22. `/home/user/Rocket.Chat/apps/meteor/server/models/raw/PushToken.ts` - Push token (legacy)
23. `/home/user/Rocket.Chat/apps/meteor/server/models/raw/Subscriptions.ts` - Subscriptions model
24. `/home/user/Rocket.Chat/packages/core-typings/src/AppsTokens.ts` - AppsTokens type
25. `/home/user/Rocket.Chat/packages/core-typings/src/INotification.ts` - Notification types

### API Endpoints
26. `/home/user/Rocket.Chat/apps/meteor/app/api/server/v1/push.ts` - REST API
27. `/home/user/Rocket.Chat/packages/rest-typings/src/v1/push.ts` - API types

### Streaming & Services
28. `/home/user/Rocket.Chat/apps/meteor/server/modules/notifications/notifications.module.ts` - Notification streams
29. `/home/user/Rocket.Chat/apps/meteor/server/services/push/service.ts` - Push service
30. `/home/user/Rocket.Chat/apps/meteor/client/startup/notifications/notification.ts` - Client startup

### Type Definitions
31. `/home/user/Rocket.Chat/packages/model-typings/src/models/INotificationQueueModel.ts` - Queue model type
32. `/home/user/Rocket.Chat/packages/model-typings/src/models/IPushTokenModel.ts` - Push token model type

