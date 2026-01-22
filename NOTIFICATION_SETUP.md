# Health Notification Setup Guide

Health alerts are sent via **Email** (for all warnings and critical issues) and **SMS** (for critical issues only).

## Email Configuration (Gmail Example)

### 1. Get Gmail App Password

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable 2-Step Verification (if not already enabled)
3. Go to "App passwords" section
4. Create app password for "Mail"
5. Copy the 16-character password

### 2. Set Environment Variables

Add to your `.env` file:

```bash
# Email Configuration (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
ALERT_EMAIL_FROM=your-email@gmail.com
ALERT_EMAIL_TO=alerts@yourcompany.com  # Where to send alerts
```

### Other Email Providers

**Outlook/Office 365:**
```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
```

**Custom SMTP:**
```bash
SMTP_HOST=mail.yourcompany.com
SMTP_PORT=465  # or 587
SMTP_SECURE=true  # true for port 465
SMTP_USER=alerts@yourcompany.com
SMTP_PASS=your-password
```

---

## SMS Configuration (Twilio)

### 1. Create Twilio Account

1. Sign up at [twilio.com/try-twilio](https://www.twilio.com/try-twilio)
2. Get free trial credit ($15)
3. Complete phone verification

### 2. Get Credentials

1. Go to [Twilio Console](https://console.twilio.com/)
2. Copy your **Account SID**
3. Copy your **Auth Token**
4. Get a Twilio phone number:
   - Go to "Phone Numbers" → "Buy a number"
   - Select country and capabilities (SMS)
   - Purchase number (free with trial credit)

### 3. Set Environment Variables

Add to your `.env` file:

```bash
# SMS Configuration (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_FROM_NUMBER=+12345678900  # Your Twilio number
TWILIO_TO_NUMBER=+19876543210    # Your mobile number
```

**Note:** Phone numbers must be in E.164 format: `+[country code][number]`

---

## Testing Configuration

### Test via API

```bash
curl -X POST http://localhost:3000/api/admin/test-notifications | jq
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "email": {
      "configured": true,
      "sent": true,
      "message": "Test email sent successfully"
    },
    "sms": {
      "configured": true,
      "sent": true,
      "message": "Test SMS sent successfully"
    }
  }
}
```

### What Gets Sent

**Test Email:**
- Subject: `[WARNING] DuxSoup ETL Health Alert`
- Contains: "This is a test notification"
- HTML formatted with metrics

**Test SMS:**
- Content: "🧪 DuxSoup ETL test SMS - configuration working!"
- Sent to `TWILIO_TO_NUMBER`

---

## Alert Behavior

### Email Alerts

**Sent for:**
- ⚠️ **WARNINGS** (detailed report)
- 🚨 **CRITICAL** (detailed report)

**Email includes:**
- Status badge (color-coded)
- Critical issues list
- Warnings list
- System metrics
- Timestamp
- Recommendations

### SMS Alerts

**Sent for:**
- 🚨 **CRITICAL ONLY** (brief alert)

**SMS includes:**
- Status emoji
- First 2 critical issues
- Issue count
- "Check email for details"

**Note:** SMS is kept brief due to character limits.

---

## Alert Schedule

Health checks run **every 6 hours** via the background scheduler.

Manual health check (no alerts):
```bash
# Check logs
tail -f /tmp/server.log | grep -i health
```

---

## Troubleshooting

### Email Not Sending

**"Authentication failed"**
- Gmail: Ensure you're using an App Password, not your regular password
- Check SMTP_USER and SMTP_PASS are correct

**"Connection timeout"**
- Check SMTP_HOST and SMTP_PORT
- Try SMTP_SECURE=false for port 587
- Try SMTP_SECURE=true for port 465

**"Not configured"**
- Ensure all required variables are set:
  - SMTP_HOST
  - SMTP_USER
  - SMTP_PASS
  - ALERT_EMAIL_TO

### SMS Not Sending

**"Not configured"**
- Ensure all required variables are set:
  - TWILIO_ACCOUNT_SID
  - TWILIO_AUTH_TOKEN
  - TWILIO_FROM_NUMBER
  - TWILIO_TO_NUMBER

**"Invalid phone number"**
- Use E.164 format: `+[country][number]`
- Example: `+14155551234` (not `415-555-1234`)

**"Unverified number" (Trial accounts)**
- During Twilio trial, you can only send to verified numbers
- Verify your mobile number in Twilio Console
- Upgrade to paid account to remove this restriction

### Check Logs

```bash
tail -f /tmp/server.log | grep -i notification
```

---

## Cost Estimates

### Email (Gmail)
- **Free** (no cost for sending via Gmail SMTP)

### SMS (Twilio)
- **Trial**: $15 free credit
- **Production**: ~$0.0075 per SMS in US
- **Example**: 100 SMS/month = $0.75/month
- **Critical alerts only**: Minimal cost (a few dollars/year)

---

## Configuration Examples

### Minimal (Email Only)

```bash
# Only email alerts
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@company.com
SMTP_PASS=your-app-password
ALERT_EMAIL_TO=devops@company.com
```

**Result:** Email for warnings and critical, no SMS

### Full (Email + SMS)

```bash
# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@company.com
SMTP_PASS=your-app-password
ALERT_EMAIL_TO=devops@company.com

# SMS
TWILIO_ACCOUNT_SID=ACxxxxxxx...
TWILIO_AUTH_TOKEN=your_token
TWILIO_FROM_NUMBER=+12345678900
TWILIO_TO_NUMBER=+19876543210
```

**Result:** Email for warnings/critical, SMS for critical only

### Disable Notifications

Remove or comment out notification variables:

```bash
# SMTP_HOST=...
# TWILIO_ACCOUNT_SID=...
```

**Result:** Health checks still run, but no alerts sent (logs only)

---

## Sample Alert

### Critical Email Alert

```
Subject: [CRITICAL] DuxSoup ETL Health Alert

🚨 DuxSoup ETL Health Alert: CRITICAL
Checked at: 1/21/2026, 5:30:00 PM

CRITICAL ISSUES:
  - 127 pending dead letters (threshold: 100)
    Recommendation: Investigate dead letter causes and replay

  - 12.5% of people missing canonical_id
    Recommendation: Run canonical ID backfill script

METRICS:
  Total People: 12,345
  Pending Dead Letters: 127
  Canonical ID Coverage: 87.5%
```

### Critical SMS Alert

```
🚨 DuxSoup ETL CRITICAL:
• 127 pending dead letters (threshold: 100)
• 12.5% missing canonical_id
Check email for details.
```

---

## Security Best Practices

1. **Never commit `.env` file** (already in `.gitignore`)
2. **Use app passwords** for Gmail (not your account password)
3. **Rotate credentials** periodically
4. **Limit email recipients** to operations team only
5. **Keep Twilio tokens secret** (treat like API keys)
6. **Monitor Twilio usage** to detect unauthorized access

---

## Next Steps

1. ✅ Set environment variables
2. ✅ Test configuration: `POST /api/admin/test-notifications`
3. ✅ Verify email received
4. ✅ Verify SMS received (if configured)
5. ✅ Monitor health check logs

Done! Your health monitoring is now configured.
