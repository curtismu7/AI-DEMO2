// check-airline-open-fare.groovy - runs the open-fare logic of groovy/p1az-decision.groovy in isolation:
// the parseStatedAmount, lookupOpenFare, lookupBookingFacts and decideHitlPreapproval closures, AND the
// real `if (toolName == 'book_airline_flight') { ... }` block of the script (extracted by brace matching and
// evaluated against a stub binding), so what Authorize would receive as Amount / TransactionAmount is
// checked on the real statements. No IG, no network; the only files read are the two named below.
//   groovy ping-gateway/scripts/check-airline-open-fare.groovy <ping-gateway dir>
// Reads <dir>/scripts/groovy/p1az-decision.groovy and <dir>/config/airline-booking-policy-data.json.
// Exit 0 when every case holds. check-airline-booking-data.test.js runs it (local groovy, else the IG image,
// docker run --network none) and re-runs it against deliberately broken copies (mutation checks).
import groovy.json.JsonSlurper

def dir = args[0]
def src = new File(dir + '/scripts/groovy/p1az-decision.groovy').text
def dataFile = dir + '/config/airline-booking-policy-data.json'
def REAL_DATA_PATH = '/var/gateway/config/airline-booking-policy-data.json'

int fails = 0
def check = { String label, boolean ok -> println((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) fails++ }

// ── load the closures ───────────────────────────────────────────────────────────────────────
def shell = new GroovyShell()
['lookupBookingFacts', 'parseStatedAmount', 'lookupOpenFare', 'decideHitlPreapproval'].each { name ->
    int st = src.indexOf("def ${name} = {")
    assert st >= 0 : "${name} closure not found"
    int en = src.indexOf('\n}\n', st) + 2
    shell.setVariable(name, null)
    shell.evaluate(src.substring(st, en).replace("def ${name} =", "${name} ="))
}
def lookupBookingFacts = shell.getVariable('lookupBookingFacts')
def parseStated = shell.getVariable('parseStatedAmount')
def lookupOpen = shell.getVariable('lookupOpenFare')
def decide = shell.getVariable('decideHitlPreapproval')

// ── the real booking block, evaluated against a stub binding ────────────────────────────────
def blockStart = src.indexOf("if (toolName == 'book_airline_flight') {")
assert blockStart >= 0 : 'book_airline_flight block not found'
int depth = 0
int blockEnd = -1
for (int i = src.indexOf('{', blockStart); i < src.length(); i++) {
    char c = src.charAt(i)
    if (c == ('{' as char)) depth++
    else if (c == ('}' as char) && --depth == 0) { blockEnd = i + 1; break }
}
assert blockEnd > 0 : 'unbalanced braces'
def blockSrc = 'import groovy.json.JsonSlurper\n' + src.substring(blockStart, blockEnd)
assert blockSrc.contains(REAL_DATA_PATH) : 'the block no longer reads the gateway data file'

// json: the tool-call arguments as JSON text (so numbers get the types JsonSlurper gives in the real filter)
def runBlock = { String json, boolean trusted, String sub, String path = null ->
    def args = new JsonSlurper().parseText(json)
    def amt = args instanceof Map ? args.amount : null
    def b = new Binding()
    b.setVariable('toolName', 'book_airline_flight')
    b.setVariable('args', args)
    b.setVariable('amt', amt)
    b.setVariable('sub', sub)
    b.setVariable('trustedCaller', trusted)
    b.setVariable('logger', [warn: { Object m -> }, info: { Object m -> }])
    b.setVariable('transactionAmount', amt != null ? String.valueOf(amt) : '0')
    ['bookingFare', 'bookingLimit', 'bookingSource', 'bookingOverride', 'bookingFareSource'].each { b.setVariable(it, null) }
    b.setVariable('bookingError', '')
    ['lookupBookingFacts', 'parseStatedAmount', 'lookupOpenFare'].each { b.setVariable(it, shell.getVariable(it)) }
    new GroovyShell(b).evaluate(blockSrc.replace(REAL_DATA_PATH, path ?: dataFile))
    return b.variables
}
def S = { Object v -> v == null ? null : v.toString() }

// ── parseStatedAmount ───────────────────────────────────────────────────────────────────────
['0.01', '1', '450', '620', '620.1', '620.10', '750.01', '99999.99', '100000', '0.07', '1E+2'].each { t ->
    check("parseStatedAmount accepts the number ${t}", parseStated(new BigDecimal(t)) != null)
}
check('parseStatedAmount accepts an Integer 450', S(parseStated(450)) == '450')
check('parseStatedAmount accepts a Long 450', S(parseStated(450L)) == '450')
check('parseStatedAmount accepts a Double 620.1', S(parseStated(620.1d)) == '620.1')
check('parseStatedAmount accepts a Double 0.07', S(parseStated(0.07d)) == '0.07')
['0', '-0.01', '-5', '100000.01', '1.005', '620.001', '0.001', '1E-7', '1E+9', '100001'].each { t ->
    check("parseStatedAmount refuses the number ${t}", parseStated(new BigDecimal(t)) == null)
}
check('parseStatedAmount refuses NaN', parseStated(Double.NaN) == null)
check('parseStatedAmount refuses Infinity', parseStated(Double.POSITIVE_INFINITY) == null)
check('parseStatedAmount refuses -Infinity', parseStated(Double.NEGATIVE_INFINITY) == null)
check('parseStatedAmount refuses 0.1+0.2 (not a 2-decimal number)', parseStated(0.1d + 0.2d) == null)
check('parseStatedAmount refuses a huge BigInteger', parseStated(new BigInteger('1' + '0' * 40)) == null)
[null, '620', '620 USD', '$620', '', ' 620', 'NaN', true, false, [620], [a: 620], new Object()].each { v ->
    check("parseStatedAmount refuses the non-number ${v == null ? 'null' : v.getClass().simpleName + ':' + v}", parseStated(v) == null)
}

// ── lookupOpenFare: the gate ────────────────────────────────────────────────────────────────
def data = new JsonSlurper().parse(new File(dataFile))
def R
check('the data file lists SH000 in openFareFlights', data.openFareFlights == ['SH000'])
check('SH000 is not in the catalogue', !data.flights.containsKey('SH000'))
R = lookupOpen(data, 'SH000', 450, true, 'u1')
check('trusted + open-fare flight + valid amount -> stated fare 450, source default, fareSource stated, limit 500',
    R.fare.toPlainString() == '450' && R.fareSource == 'stated' && R.source == 'default' && R.limit.toPlainString() == '500' && !R.containsKey('error'))
R = lookupOpen(data, ' sh000 ', 0.01g, true, 'u1')
check('flight number trimmed and upper-cased, 0.01 accepted', R.fare.toPlainString() == '0.01' && R.fareSource == 'stated')
R = lookupOpen(data, 'SH000', 450, false, 'u1')
check('UNTRUSTED + valid amount -> open_fare_untrusted', R.error == 'open_fare_untrusted' && !R.containsKey('fare'))
R = lookupOpen(data, 'SH000', 'junk', false, 'u1')
check('UNTRUSTED + invalid amount -> open_fare_untrusted (trust is checked first)', R.error == 'open_fare_untrusted')
[null, 0, -1, '620', '620 USD', true, 100000.01g, 1.005g, [620], [a: 1]].each { v ->
    R = lookupOpen(data, 'SH000', v, true, 'u1')
    check("trusted + open-fare flight + amount ${v} -> open_fare_bad_amount", R.error == 'open_fare_bad_amount' && !R.containsKey('fare'))
}
['SH106', 'SH101', 'UA502', 'SH999', '', null, 'SH0000', 'SH00', '__proto__', 'constructor', ['SH000'], [a: 1]].each { f ->
    check("not an open-fare flight (${f}) -> null so the catalogue path decides", lookupOpen(data, f, 450, true, 'u1') == null)
}
check('openFareFlights absent -> null', lookupOpen([flights: [SH106: 620], defaultMember: [agentSpendLimitUsd: 500]], 'SH000', 450, true, 'u1') == null)
check('openFareFlights empty -> null', lookupOpen([openFareFlights: [], flights: [:], defaultMember: [:]], 'SH000', 450, true, 'u1') == null)
check('openFareFlights a string, not a list -> null', lookupOpen([openFareFlights: 'SH000', flights: [:], defaultMember: [:]], 'SH000', 450, true, 'u1') == null)
check('openFareFlights a map, not a list -> null', lookupOpen([openFareFlights: [SH000: 1], flights: [:], defaultMember: [:]], 'SH000', 450, true, 'u1') == null)
check('data a list -> null', lookupOpen([1, 2, 3], 'SH000', 450, true, 'u1') == null)
check('data null -> null', lookupOpen(null, 'SH000', 450, true, 'u1') == null)
def withMember = new JsonSlurper().parseText('{"openFareFlights":["SH000"],"flights":{},"defaultMember":{"agentSpendLimitUsd":500},"members":{"sam":{"agentSpendLimitUsd":300}}}')
R = lookupOpen(withMember, 'SH000', 450, true, 'sam')
check('member sam: stated 450, own limit 300, source sub', R.fare.toPlainString() == '450' && R.limit.toPlainString() == '300' && R.source == 'sub')
def threw = false
try { lookupOpen(new JsonSlurper().parseText('{"openFareFlights":["SH000"],"flights":{}}'), 'SH000', 450, true, 'x') } catch (Exception e) { threw = true }
check('no member profile at all -> throws (becomes booking_data_unavailable)', threw)

// ── the real booking block: what Authorize would receive ───────────────────────────────────
def V
V = runBlock('{"flight_number":"SH000","amount":450}', true, 'u1')
check('block: trusted SH000 450 -> no error', V.bookingError == '')
check('block: transactionAmount (sent as Amount and TransactionAmount) is the stated 450', V.transactionAmount == '450')
check('block: bookingFare 450, limit 500, fareSource stated', S(V.bookingFare) == '450' && S(V.bookingLimit) == '500' && V.bookingFareSource == 'stated')
check('block: no fareOverride recorded (nothing differs from the stated amount)', V.bookingOverride == null)
['0.01', '1', '620', '620.10', '750.01', '99999.99', '100000'].each { t ->
    V = runBlock('{"flight_number":"SH000","amount":' + t + '}', true, 'u1')
    check("block: trusted SH000 amount ${t} -> Amount ${t}, stated", V.bookingError == '' && V.transactionAmount == t && V.bookingFareSource == 'stated')
}
V = runBlock('{"flight_number":"sh000","amount":620}', true, 'u1')
check('block: lower-case flight number still open fare', V.bookingError == '' && V.transactionAmount == '620' && V.bookingFareSource == 'stated')
V = runBlock('{"flight_number":"SH000","amount":450}', false, 'u1')
check('block: UNTRUSTED SH000 -> open_fare_untrusted, no fare set', V.bookingError == 'open_fare_untrusted' && V.bookingFare == null && V.bookingFareSource == null)
['0', '-5', '"620"', '"620 USD"', 'true', 'null', '100000.01', '1.005', '620.001', '[620]', '{"v":620}', '1e9'].each { t ->
    V = runBlock('{"flight_number":"SH000","amount":' + t + '}', true, 'u1')
    check("block: trusted SH000 amount ${t} -> open_fare_bad_amount, no fare set", V.bookingError == 'open_fare_bad_amount' && V.bookingFare == null && V.bookingFareSource == null)
}
V = runBlock('{"flight_number":"SH000"}', true, 'u1')
check('block: trusted SH000 without amount -> open_fare_bad_amount', V.bookingError == 'open_fare_bad_amount' && V.bookingFare == null)

// catalogue flights are exactly as before: the catalogue fare wins and a caller amount is ignored
V = runBlock('{"flight_number":"SH106","amount":1}', true, 'u1')
check('block: catalogue SH106 with caller amount 1 -> Amount is the catalogue 620, fareSource catalogue',
    V.bookingError == '' && V.transactionAmount == '620' && S(V.bookingFare) == '620' && V.bookingFareSource == 'catalogue')
check('block: catalogue override recorded (claimed 1, authoritative 620)', V.bookingOverride != null && V.bookingOverride.claimed == '1' && V.bookingOverride.authoritative == '620')
V = runBlock('{"flight_number":"SH106","amount":100000}', true, 'u1')
check('block: catalogue SH106 with a huge caller amount -> still 620', V.transactionAmount == '620' && V.bookingFareSource == 'catalogue')
V = runBlock('{"flight_number":"SH106"}', true, 'u1')
check('block: catalogue SH106 without amount -> 620', V.transactionAmount == '620' && V.bookingFareSource == 'catalogue')
V = runBlock('{"flight_number":"SH106","amount":450}', false, 'u1')
check('block: UNTRUSTED catalogue SH106 is not an open-fare failure, catalogue 620 as today', V.bookingError == '' && V.transactionAmount == '620' && V.bookingFareSource == 'catalogue')
V = runBlock('{"flight_number":"SH105","amount":500.01}', true, 'u1')
check('block: catalogue SH105 500.01 exact', V.transactionAmount == '500.01' && V.bookingOverride == null)
V = runBlock('{"flight_number":"SH999","amount":450}', true, 'u1')
check('block: unknown flight with a stated amount -> unknown_flight_fare (only openFareFlights opt in)', V.bookingError == 'unknown_flight_fare' && V.bookingFare == null)
V = runBlock('{"amount":450}', true, 'u1')
check('block: no flight_number with an amount -> unknown_flight_fare', V.bookingError == 'unknown_flight_fare')
V = runBlock('{"flight_number":"SH000","amount":450}', true, 'u1', File.createTempFile('nofile', '.json').with { delete(); path })
check('block: unreadable data file -> booking_data_unavailable', V.bookingError == 'booking_data_unavailable')

// the stated amount is judged against the member's own limit, as the catalogue fare is
def tmp = File.createTempFile('open-fare-member', '.json')
tmp.text = '{"openFareFlights":["SH000"],"flights":{},"defaultMember":{"agentSpendLimitUsd":500},"members":{"sam":{"agentSpendLimitUsd":300}}}'
V = runBlock('{"flight_number":"SH000","amount":450}', true, 'sam', tmp.path)
check('block: member sam gets his own limit 300 next to the stated 450', S(V.bookingFare) == '450' && S(V.bookingLimit) == '300' && V.bookingSource == 'sub')
tmp.delete()
tmp = File.createTempFile('open-fare-none', '.json')
tmp.text = '{"openFareFlights":[],"flights":{"SH106":620},"defaultMember":{"agentSpendLimitUsd":500}}'
V = runBlock('{"flight_number":"SH000","amount":450}', true, 'u1', tmp.path)
check('block: SH000 not listed in openFareFlights -> unknown_flight_fare, the stated amount is not used', V.bookingError == 'unknown_flight_fare' && V.bookingFare == null)
tmp.text = '{"flights":{"SH106":620},"defaultMember":{"agentSpendLimitUsd":500}}'
V = runBlock('{"flight_number":"SH000","amount":450}', true, 'u1', tmp.path)
check('block: data without an openFareFlights key -> unknown_flight_fare', V.bookingError == 'unknown_flight_fare')
tmp.delete()

// ── HITL pre-approval compares the STATED amount with the limit ──────────────────────────────
def T = 'book_airline_flight', H = 'user-limit'
V = runBlock('{"flight_number":"SH000","amount":450}', true, 'u1')
def pre = decide(true, T, H, '', V.bookingFare, V.bookingLimit, null)
check('pre-approval: stated 450 <= limit 500 -> granted with fare 450', pre != null && pre.fare == '450' && pre.limit == '500')
V = runBlock('{"flight_number":"SH000","amount":500}', true, 'u1')
check('pre-approval: stated 500 == limit 500 -> granted', decide(true, T, H, '', V.bookingFare, V.bookingLimit, null) != null)
V = runBlock('{"flight_number":"SH000","amount":500.01}', true, 'u1')
check('pre-approval: stated 500.01 > limit 500 -> NOT granted', decide(true, T, H, '', V.bookingFare, V.bookingLimit, null) == null)
V = runBlock('{"flight_number":"SH000","amount":620}', true, 'u1')
check('pre-approval: stated 620 > limit 500 -> NOT granted', decide(true, T, H, '', V.bookingFare, V.bookingLimit, null) == null)
check('pre-approval: stated 620 vs trusted header limit 750 -> granted, source header', decide(true, T, H, '', V.bookingFare, V.bookingLimit, '750')?.limitSource == 'header')
V = runBlock('{"flight_number":"SH000","amount":450}', true, 'u1')
check('pre-approval: stated 450 vs header limit 300 -> NOT granted', decide(true, T, H, '', V.bookingFare, V.bookingLimit, '300') == null)
V = runBlock('{"flight_number":"SH000","amount":450}', false, 'u1')
check('pre-approval: an untrusted open-fare call has no fare to approve -> null', decide(false, T, H, '', V.bookingFare, V.bookingLimit, null) == null)
V = runBlock('{"flight_number":"SH000","amount":0}', true, 'u1')
check('pre-approval: a refused amount leaves bookingFare null -> null', decide(true, T, H, '', V.bookingFare, V.bookingLimit, null) == null)

println(fails == 0 ? 'ALL OK' : "FAILURES: ${fails}")
System.exit(fails == 0 ? 0 : 1)
