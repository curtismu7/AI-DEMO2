/**
 * Support Agent FAQ Database
 * 12 common banking Q&A pairs
 */

const FAQ_DATABASE = [
  {
    id: 1,
    question: "What is your overdraft fee?",
    answer: "Our standard overdraft fee is $35 per transaction. You can avoid this by enabling overdraft protection linked to a savings account or credit line.",
    category: "Fees"
  },
  {
    id: 2,
    question: "How long does an international transfer take?",
    answer: "International transfers typically take 3-5 business days depending on the destination country and whether intermediary banks are involved.",
    category: "Transfers"
  },
  {
    id: 3,
    question: "What is the daily ATM withdrawal limit?",
    answer: "The daily ATM withdrawal limit is $1,000 for most accounts. You can increase this limit by contacting customer service or through online banking.",
    category: "ATM"
  },
  {
    id: 4,
    question: "How do I enable two-factor authentication?",
    answer: "Go to Settings > Security > Two-Factor Authentication in online banking. You can choose SMS, email, or an authenticator app as your second factor.",
    category: "Security"
  },
  {
    id: 5,
    question: "What is the minimum balance requirement?",
    answer: "Most checking accounts require a $250 minimum balance. Savings accounts require $100. Falling below this may result in a $5 monthly maintenance fee.",
    category: "Account"
  },
  {
    id: 6,
    question: "Can I transfer money between my accounts instantly?",
    answer: "Yes! Transfers between your own accounts appear immediately. Transfers to other banks take 1-2 business days depending on the receiving bank.",
    category: "Transfers"
  },
  {
    id: 7,
    question: "What should I do if my card is lost or stolen?",
    answer: "Contact us immediately at our 24/7 fraud line: 1-800-BANK-123. We'll cancel your card and can rush a replacement to you within 1-2 business days.",
    category: "Security"
  },
  {
    id: 8,
    question: "How do I set up a direct deposit?",
    answer: "You'll need to provide your employer with your account number and routing number (found on your checks or in online banking under Account Details).",
    category: "Account"
  },
  {
    id: 9,
    question: "What fees apply to international transfers?",
    answer: "International wire transfers have a $30 outgoing fee. Incoming international transfers are free, but there may be fees charged by intermediary banks.",
    category: "Fees"
  },
  {
    id: 10,
    question: "Can I schedule future transfers?",
    answer: "Yes! In online banking, go to Transfers > Schedule Future Transfer. You can set up recurring or one-time transfers to go out on any future date.",
    category: "Transfers"
  },
  {
    id: 11,
    question: "What is your customer service phone number?",
    answer: "You can reach our customer service team 24/7 at 1-800-BANK-123. Wait times are typically under 5 minutes during business hours.",
    category: "Customer Service"
  },
  {
    id: 12,
    question: "How do I report unauthorized transactions?",
    answer: "Report suspected fraud immediately by calling our fraud line at 1-800-BANK-123 or through online banking under Security > Report Fraud. We'll investigate within 10 business days.",
    category: "Security"
  }
];

module.exports = {
  FAQ_DATABASE
};
