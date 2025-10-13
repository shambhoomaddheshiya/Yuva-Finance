
import { Timestamp } from 'firebase/firestore';

export type Member = {
  id: string;
  name: string;
  phone: string;
  aadhaar: string;
  joinDate: string;
  status: 'active' | 'inactive';
  totalDeposited: number;
  totalWithdrawn: number; // This will now represent total loans taken by the member
  currentBalance: number; // This represents their deposit balance
  interestEarned: number; // This is interest earned by member on their deposit, can be removed if not used.
  loanBalance: number; // New field to track outstanding loan
};

export type Transaction = {
  id: string;
  memberId: string;
  type: 'deposit' | 'loan' | 'repayment';
  amount: number; // For deposit/loan, this is the amount. For repayment, it's total amount paid (principal + interest).
  date: Timestamp | string;
  description?: string;
  balance: number; // For deposits, this is the new deposit balance. For loans/repayments, it's the new loan balance.
  principal?: number; // For repayments, the principal amount
  interest?: number; // For repayments, the interest amount
};

export type GroupSettings = {
  groupName: string;
  monthlyContribution: number;
  interestRate: number;
  totalMembers: number;
  totalFund: number; // Will now be remainingFund
  establishedDate: string;
  totalDeposit?: number;
  totalLoan?: number;
  totalRepayment?: number; // This will now track total principal repaid
  totalInterest?: number; // New field for total interest earned by the group
};
