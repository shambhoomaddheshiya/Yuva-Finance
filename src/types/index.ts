import { Timestamp } from 'firebase/firestore';

export type Member = {
  id: string;
  name: string;
  phone: string;
  aadhaar: string;
  joinDate: string;
  status: 'active' | 'inactive';
  totalDeposited: number;
  totalWithdrawn: number;
  currentBalance: number;
  interestEarned: number;
};

export type Transaction = {
  id: string;
  memberId: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  date: Timestamp | string; // Support for both old string and new Timestamp dates
  description?: string;
  balance: number;
};

export type GroupSettings = {
  groupName: string;
  monthlyContribution: number;
  interestRate: number;
  totalMembers: number;
  totalFund: number;
  establishedDate: string;
};
