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
  interestEarned: number;
  loanBalance: number; // New field to track outstanding loan
};

export type Transaction = {
  id: string;
  memberId: string;
  type: 'deposit' | 'loan' | 'repayment';
  amount: number;
  date: Timestamp | string;
  description?: string;
  balance: number; // For deposits, this is the new deposit balance. For loans/repayments, it's the new loan balance.
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
  totalRepayment?: number;
};
