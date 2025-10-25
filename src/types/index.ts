
import { Timestamp } from 'firebase/firestore';

export type Member = {
  id: string;
  name: string;
  phone: string;
  aadhaar: string;
  joinDate: string;
  status: 'active' | 'inactive' | 'closed';
};

export type Transaction = {
  id: string;
  memberId: string;
  type: 'deposit' | 'loan' | 'repayment' | 'expense' | 'loan-waived';
  amount: number; // For deposit/loan/expense, this is the amount. For repayment, it's total amount paid (principal + interest).
  date: Timestamp | string;
  description?: string;
  principal?: number; // For repayments, the principal amount
  interest?: number; // For repayments, the interest amount
};

export type GroupSettings = {
  groupName: string;
  monthlyContribution: number;
  interestRate: number;
  establishedDate: string;
};
