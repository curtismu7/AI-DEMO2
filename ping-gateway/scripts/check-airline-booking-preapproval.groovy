// check-airline-booking-preapproval.groovy - runs the decideHitlPreapproval closure of
// groovy/p1az-decision.groovy in isolation (no IG, no network, no files other than the Groovy source).
//   groovy ping-gateway/scripts/check-airline-booking-preapproval.groovy <ping-gateway dir>
// Exit 0 when every case holds. check-airline-booking-data.test.js runs it (local groovy, else the IG image).
def src = new File(args[0] + '/scripts/groovy/p1az-decision.groovy').text
def start = src.indexOf('def decideHitlPreapproval = {')
assert start >= 0 : 'decideHitlPreapproval closure not found'
def end = src.indexOf('\n}\n', start) + 2
def closureSrc = src.substring(start, end).replace('def decideHitlPreapproval =', 'decideHitlPreapproval =')
def shell = new GroovyShell()
shell.setVariable('decideHitlPreapproval', null)
shell.evaluate(closureSrc)
def decide = shell.getVariable('decideHitlPreapproval')
int fails = 0
def check = { String label, boolean ok -> println((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) fails++ }
def D = { String s -> new BigDecimal(s) }
def T = 'book_airline_flight', H = 'user-limit'
// args: trusted, tool, preapprovedHdr, challengeId, fare, fileLimit(default), limitHdr
def granted = { r -> r != null && r.basis == 'user-limit' }
def r

// --- granted ---
r = decide(true, T, H, '', D('480'), D('500'), null)
check('trusted + booking tool + exact header + fare 480 <= default 500 -> granted, source default', granted(r) && r.fare == '480' && r.limit == '500' && r.limitSource == 'default')
r = decide(true, T, H, '', D('500'), D('500'), null)
check('fare exactly equal to the limit (500 == 500) IS pre-approved', granted(r))
r = decide(true, T, H, '', D('500.01'), D('500'), null)
check('fare == limit + 0.01 is NOT pre-approved', r == null)
r = decide(true, T, H, '', D('620'), D('500'), null)
check('fare 620 > 500 -> not granted', r == null)
r = decide(true, T, H, '', D('750'), D('500'), '750')
check('header limit 750 (higher than default 500) honoured: 750 <= 750 -> granted, source header', granted(r) && r.limit == '750' && r.limitSource == 'header')
r = decide(true, T, H, '', D('750.01'), D('500'), '750')
check('header limit 750, fare 750.01 -> not granted', r == null)
r = decide(true, T, H, '', D('480'), D('500'), '300')
check('header limit 300 LOWER than default 500 is honoured: fare 480 > 300 -> not granted', r == null)
r = decide(true, T, H, '', D('180'), D('500'), '300')
check('header limit 300, fare 180 -> granted with limit 300 from header', granted(r) && r.limit == '300' && r.limitSource == 'header')
r = decide(true, T, H, '', D('500.01'), D('500'), '500.01')
check('decimal header limit 500.01 equal to fare 500.01 -> granted, exact', granted(r) && r.limit == '500.01')
r = decide(true, T, H, '', D('180'), D('500'), '1234567')
check('7-character header limit 1234567 accepted', granted(r) && r.limit == '1234567')
r = decide(true, T, H, '', D('180'), D('500'), '12345678')
check('8-character header limit rejected -> default 500 used', granted(r) && r.limit == '500' && r.limitSource == 'default')

// --- invalid header limits fall back to the default (strict > then decides) ---
['NaN', 'Infinity', '-5', '1e9', ' 500', '500 ', '500,0', '0x1F', '', '0', '0.0', '5.', '.5', '5..0', '+5', '１２３', 'abc', '99999999', "500\n"].each { bad ->
    def ok = decide(true, T, H, '', D('480'), D('500'), bad)
    check("invalid header limit [${bad.replace('\n', '\\n')}] ignored -> falls back to default 500 (fare 480 granted, source default)", granted(ok) && ok.limit == '500' && ok.limitSource == 'default')
    def over = decide(true, T, H, '', D('620'), D('500'), bad)
    check("invalid header limit [${bad.replace('\n', '\\n')}] cannot raise the limit: fare 620 not granted", over == null)
}
r = decide(true, T, H, '', D('480'), D('500'), 500)
check('non-string header limit (a Number) ignored -> default', granted(r) && r.limitSource == 'default')

// --- not granted: each condition on its own ---
r = decide(false, T, H, '', D('180'), D('500'), '1000')
check('untrusted caller (no/wrong secret) -> not granted, header limit ignored too', r == null)
r = decide(true, 'transfer_funds', H, '', D('180'), D('500'), null)
check('other tool -> not granted', r == null)
r = decide(true, null, H, '', D('180'), D('500'), null)
check('no tool -> not granted', r == null)
r = decide(true, T, null, '', D('180'), D('500'), null)
check('header absent -> not granted', r == null)
['User-Limit', 'USER-LIMIT', 'user-limit ', ' user-limit', 'user_limit', 'userlimit', 'true', '1', ''].each { v ->
    check("header value [${v}] -> not granted", decide(true, T, v, '', D('180'), D('500'), null) == null)
}
r = decide(true, T, H, 'abc-123', D('180'), D('500'), null)
check('header present together with a _hitl_challenge_id -> not granted (receipt path wins)', r == null)
r = decide(true, T, H, '', null, D('500'), null)
check('missing fare -> not granted (fail closed)', r == null)
r = decide(true, T, H, '', D('180'), null, null)
check('missing limit (no header, no default) -> not granted (fail closed)', r == null)
r = decide(true, T, H, '', D('180'), null, 'junk')
check('missing default and invalid header -> not granted', r == null)
r = decide(true, T, H, '', D('180'), null, '300')
check('missing default but valid header limit 300 -> granted from header', granted(r) && r.limitSource == 'header')
r = decide(true, T, H, '', D('1'), D('0'), null)
check('default limit 0 (member who allows no agent spend) -> not granted', r == null)
println(fails == 0 ? 'ALL OK' : "FAILURES: ${fails}")
System.exit(fails == 0 ? 0 : 1)
