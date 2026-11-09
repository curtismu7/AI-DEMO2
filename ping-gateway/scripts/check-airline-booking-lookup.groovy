// check-airline-booking-lookup.groovy - runs the lookupBookingFacts closure of
// groovy/p1az-decision.groovy in isolation against the real data file.
//   groovy ping-gateway/scripts/check-airline-booking-lookup.groovy <ping-gateway dir>
// Exit 0 when every case holds. check-airline-booking-data.test.js runs it when `groovy` is installed.
import groovy.json.JsonSlurper
def src = new File(args[0] + '/scripts/groovy/p1az-decision.groovy').text
def start = src.indexOf('def lookupBookingFacts = {')
def end = src.indexOf('\n}\n', start) + 2
def closureSrc = src.substring(start, end).replace('def lookupBookingFacts =', 'lookupBookingFacts =')
def shell = new GroovyShell()
shell.setVariable('lookupBookingFacts', null)
shell.evaluate(closureSrc)
def lookup = shell.getVariable('lookupBookingFacts')
def data = new JsonSlurper().parse(new File(args[0] + '/config/airline-booking-policy-data.json'))
int fails = 0
def check = { String label, boolean ok -> println((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) fails++ }
def r
r = lookup(data, 'SH105', 'u1');  check('SH105 fare exact 500.01 -> ' + r.fare.toPlainString(), r.fare.toPlainString() == '500.01')
r = lookup(data, 'sh109 ', 'u1'); check('sh109 trimmed/upper 750.01 -> ' + r.fare.toPlainString(), r.fare.toPlainString() == '750.01')
r = lookup(data, 'SH106', 'u1');  check('SH106 620 default member limit 500 source default, no tier', r.fare.toPlainString() == '620' && r.limit.toPlainString() == '500' && r.source == 'default' && !r.containsKey('tier'))
r = lookup(data, 'SH999', 'u1');  check('unknown flight -> unknown_flight_fare', r.error == 'unknown_flight_fare')
r = lookup(data, null, 'u1');     check('missing flight -> unknown_flight_fare', r.error == 'unknown_flight_fare')
r = lookup(data, [a: 1], 'u1');   check('map flight -> unknown_flight_fare', r.error == 'unknown_flight_fare')
r = lookup(data, ['SH106'], 'u1'); check('list flight -> unknown_flight_fare', r.error == 'unknown_flight_fare')
r = lookup(data, '__proto__', 'u1'); check('__proto__ -> unknown_flight_fare', r.error == 'unknown_flight_fare')
r = lookup(data, 'constructor', 'u1'); check('constructor -> unknown_flight_fare', r.error == 'unknown_flight_fare')
def withMember = new JsonSlurper().parseText('{"flights":{"SH107":940},"defaultMember":{"agentSpendLimitUsd":500},"members":{"sam":{"agentSpendLimitUsd":0}}}')
r = lookup(withMember, 'SH107', 'sam'); check('member sam: limit 0 stays 0 (not 500), source sub', r.limit.toPlainString() == '0' && r.source == 'sub')
r = lookup(withMember, 'SH107', 'other'); check('unmapped sub -> default member', r.limit.toPlainString() == '500' && r.source == 'default')
r = lookup(withMember, 'SH107', ''); check('empty sub -> default member', r.source == 'default')
def threw = false
try { lookup(new JsonSlurper().parseText('{"flights":{"SH107":940}}'), 'SH107', 'x') } catch (Exception e) { threw = true }
check('no member profile at all -> throws (becomes booking_data_unavailable)', threw)
threw = false
try { lookup([1,2,3], 'SH107', 'x') } catch (Exception e) { threw = true }
check('data is a list -> throws', threw)
r = lookup(new JsonSlurper().parseText('{"flights":{"SH107":"940"},"defaultMember":{}}'), 'SH107', 'x'); check('string fare -> unknown_flight_fare', r.error == 'unknown_flight_fare')
println(fails == 0 ? 'ALL OK' : "FAILURES: ${fails}")
System.exit(fails == 0 ? 0 : 1)
