# Test script for internal call endpoints
# Usage: .\test-internal-calls.ps1

$INTERNAL_SECRET = "c565457342943eaaba72f062512ea2c3ba080e2cf3c68aced8978baf42e71682"
$BASE_URL = "https://book8-core-api.onrender.com"
$TEST_CALL_SID = "CA$(Get-Random -Minimum 1000000 -Maximum 9999999)"
$TEST_BUSINESS_ID = "waismofit"

$headers = @{
    'x-book8-internal-secret' = $INTERNAL_SECRET
    'Content-Type' = 'application/json'
}

Write-Host "Testing Internal Call Endpoints" -ForegroundColor Cyan
Write-Host "Using Call SID: $TEST_CALL_SID" -ForegroundColor Yellow
Write-Host ""

# Test 1: POST /internal/calls/start
Write-Host "Test 1: POST /internal/calls/start" -ForegroundColor Cyan
$startBody = @{
    callSid = $TEST_CALL_SID
    businessId = $TEST_BUSINESS_ID
    from = "+16471234567"
    to = "+16477882883"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/internal/calls/start" -Method POST -Body $startBody -Headers $headers
    Write-Host "✅ Start successful!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "❌ Start failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}

Write-Host ""

# Test 2: POST /internal/calls/transcript (first time)
Write-Host "Test 2: POST /internal/calls/transcript (first time)" -ForegroundColor Cyan
$turnId = "turn-$(Get-Random -Minimum 1000 -Maximum 9999)"
$transcriptBody1 = @{
    callSid = $TEST_CALL_SID
    role = "caller"
    text = "Hello, I'd like to book an appointment"
    turnId = $turnId
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/internal/calls/transcript" -Method POST -Body $transcriptBody1 -Headers $headers
    Write-Host "✅ Transcript entry 1 successful!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "❌ Transcript entry 1 failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""

# Test 3: POST /internal/calls/transcript (second time with same turnId - should noop)
Write-Host "Test 3: POST /internal/calls/transcript (same turnId - should noop)" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/internal/calls/transcript" -Method POST -Body $transcriptBody1 -Headers $headers
    if ($response.noop) {
        Write-Host "✅ Idempotency working! Got noop response" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Expected noop but got:" -ForegroundColor Yellow
    }
    Write-Host ($response | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "❌ Transcript entry 2 failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host ""

# Test 4: POST /internal/calls/tool (first time)
Write-Host "Test 4: POST /internal/calls/tool (first time)" -ForegroundColor Cyan
$eventId = "event-$(Get-Random -Minimum 1000 -Maximum 9999)"
$toolBody1 = @{
    callSid = $TEST_CALL_SID
    tool = "check_availability"
    success = $true
    eventId = $eventId
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/internal/calls/tool" -Method POST -Body $toolBody1 -Headers $headers
    Write-Host "✅ Tool call 1 successful!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "❌ Tool call 1 failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host ""

# Test 5: POST /internal/calls/tool (second time with same eventId - should noop)
Write-Host "Test 5: POST /internal/calls/tool (same eventId - should noop)" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/internal/calls/tool" -Method POST -Body $toolBody1 -Headers $headers
    if ($response.noop) {
        Write-Host "✅ Idempotency working! Got noop response" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Expected noop but got:" -ForegroundColor Yellow
    }
    Write-Host ($response | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "❌ Tool call 2 failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host ""

# Test 6: POST /internal/calls/usage
Write-Host "Test 6: POST /internal/calls/usage" -ForegroundColor Cyan
$usageBody = @{
    callSid = $TEST_CALL_SID
    delta = @{
        llmTokens = 150
        ttsCharacters = 200
    }
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/internal/calls/usage" -Method POST -Body $usageBody -Headers $headers
    Write-Host "✅ Usage update successful!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "❌ Usage update failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""

# Test 7: POST /internal/calls/end
Write-Host "Test 7: POST /internal/calls/end" -ForegroundColor Cyan
$endBody = @{
    callSid = $TEST_CALL_SID
    status = "completed"
    durationSeconds = 120
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/internal/calls/end" -Method POST -Body $endBody -Headers $headers
    Write-Host "✅ End call successful!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "❌ End call failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""

# Test 8: GET /internal/calls/:callSid
Write-Host "Test 8: GET /internal/calls/:callSid" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/internal/calls/$TEST_CALL_SID" -Method GET -Headers $headers
    Write-Host "✅ Get call successful!" -ForegroundColor Green
    Write-Host "Call Summary:" -ForegroundColor Yellow
    Write-Host "  Call SID: $($response.call.callSid)"
    Write-Host "  Business ID: $($response.call.businessId)"
    Write-Host "  Status: $($response.call.status)"
    Write-Host "  Transcript entries: $($response.call.transcript.Count)"
    Write-Host "  Tools used: $($response.call.toolsUsed.Count)"
    Write-Host "  Usage - LLM Tokens: $($response.call.usage.llmTokens), TTS Characters: $($response.call.usage.ttsCharacters)"
    Write-Host ""
    Write-Host "Full response:" -ForegroundColor Yellow
    Write-Host ($response | ConvertTo-Json -Depth 5)
} catch {
    Write-Host "❌ Get call failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "✅ All tests completed!" -ForegroundColor Green
Write-Host "Call SID used: $TEST_CALL_SID" -ForegroundColor Yellow


