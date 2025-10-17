
'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { GroupSettings, Member, Transaction } from '@/types';
import { Banknote, Users, Percent, PiggyBank, ArrowDown, ArrowUp, Landmark, HandCoins, LibraryBig, UserCheck, UserX, Scale, CalendarClock, ShieldX } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { collection, query, doc, Timestamp } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useAdmin } from '@/context/AdminContext';


function StatCard({
  title,
  value,
  icon: Icon,
  loading,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  loading: boolean;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-3/4" />
        ) : (
          <div className="text-2xl font-bold font-headline">{value}</div>
        )}
        {description && !loading && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MonthlyOverviewStat({ title, value, loading }: { title: string; value: string; loading: boolean }) {
    return (
        <div className="flex justify-between items-center text-sm">
            <p className="text-muted-foreground">{title}</p>
            {loading ? <Skeleton className="h-5 w-24" /> : <p className="font-semibold font-mono">{value}</p>}
        </div>
    )
}

export default function DashboardPage() {
  const { user } = useUser();
  const { isAdmin } = useAdmin();
  const firestore = useFirestore();

  const ADMIN_USER_ID = 'wq8CqKB0mlbCiFGMylZejvBHiMT2';
  const dataUserId = isAdmin ? user?.uid : ADMIN_USER_ID;

  const membersRef = useMemoFirebase(() => dataUserId && firestore ? query(collection(firestore, `users/${dataUserId}/members`)) : null, [dataUserId, firestore]);
  const transactionsRef = useMemoFirebase(() => dataUserId && firestore ? query(collection(firestore, `users/${dataUserId}/transactions`)) : null, [dataUserId, firestore]);

  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
  const { data: transactions, isLoading: txLoading } = useCollection<Transaction>(transactionsRef);
  
  const loading = membersLoading || txLoading;
  
  const getTransactionDate = (tx: Transaction): Date => {
    if (tx.date instanceof Timestamp) {
      return tx.date.toDate();
    }
    if (tx.date instanceof Date) {
      return tx.date;
    }
    // Fallback for string dates
    return new Date(tx.date as string);
  };


  const { totalMembers, activeMembersCount, inactiveMembersCount } = useMemo(() => {
    if (!members) {
        return { totalMembers: 0, activeMembersCount: 0, inactiveMembersCount: 0 };
    }
    const total = members.length;
    const active = members.filter(m => m.status === 'active').length;
    const inactive = total - active;
    return { totalMembers: total, activeMembersCount: active, inactiveMembersCount: inactive };
  }, [members]);

  const { totalDeposits, totalLoan, totalRepayment, totalInterest, remainingFund, outstandingLoan } = useMemo(() => {
    if (!transactions || !members) {
      return { totalDeposits: 0, totalLoan: 0, totalRepayment: 0, totalInterest: 0, remainingFund: 0, outstandingLoan: 0 };
    }
    
    const activeMemberIds = new Set(members.filter(m => m.status === 'active').map(m => m.id));
    const activeTransactions = transactions.filter(t => activeMemberIds.has(t.memberId));

    const memberDeposits = activeTransactions
      .filter(t => t.type === 'deposit')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalLoanValue = activeTransactions
      .filter(t => t.type === 'loan')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalRepaymentValue = activeTransactions
      .filter(t => t.type === 'repayment')
      .reduce((sum, t) => sum + (t.principal || 0), 0);
    
    const totalInterestValue = activeTransactions
      .filter(t => t.type === 'repayment')
      .reduce((sum, t) => sum + (t.interest || 0), 0);
    
    const totalExpenses = activeTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalDepositsValue = (memberDeposits + totalInterestValue) - totalExpenses;
    const outstandingLoanValue = totalLoanValue - totalRepaymentValue;
    const remainingFundValue = (memberDeposits + totalInterestValue + totalRepaymentValue) - totalLoanValue;
    
    return { 
      totalDeposits: totalDepositsValue, 
      totalLoan: totalLoanValue, 
      totalRepayment: totalRepaymentValue, 
      totalInterest: totalInterestValue, 
      remainingFund: remainingFundValue,
      outstandingLoan: outstandingLoanValue
    };
  }, [transactions, members]);

  const monthlyOverview = useMemo(() => {
    const initialResult = {
      monthlyDeposits: 0,
      monthlyLoan: 0,
      monthlyInterest: 0,
      monthlyPrincipal: 0,
      displayMonth: new Date(),
    };

    if (!transactions || transactions.length === 0 || !members) {
      return initialResult;
    }

    const sortedTransactions = [...transactions].sort((a, b) => getTransactionDate(b).getTime() - getTransactionDate(a).getTime());
    const latestTransactionDate = getTransactionDate(sortedTransactions[0]);
    
    const monthStart = startOfMonth(latestTransactionDate);
    const monthEnd = endOfMonth(latestTransactionDate);

    const activeMemberIds = new Set(members.filter(m => m.status === 'active').map(m => m.id));
    const monthlyTransactions = transactions.filter(tx => {
        const txDate = getTransactionDate(tx);
        return txDate >= monthStart && txDate <= monthEnd && activeMemberIds.has(tx.memberId);
    });
    
    const monthlyDeposits = monthlyTransactions.filter(t => t.type === 'deposit').reduce((sum, t) => sum + t.amount, 0);
    const monthlyLoan = monthlyTransactions.filter(t => t.type === 'loan').reduce((sum, t) => sum + t.amount, 0);
    const monthlyRepayments = monthlyTransactions.filter(t => t.type === 'repayment');
    
    const monthlyInterest = monthlyRepayments.reduce((sum, t) => sum + (t.interest || 0), 0);
    const monthlyPrincipal = monthlyRepayments.reduce((sum, t) => sum + (t.principal || 0), 0);
    
    return { 
        monthlyDeposits, 
        monthlyLoan, 
        monthlyInterest, 
        monthlyPrincipal,
        displayMonth: latestTransactionDate
    };

  }, [transactions, members]);

    const recentTransactions = useMemo(() => {
        if (!transactions) return [];
        return [...transactions]
            .sort((a, b) => getTransactionDate(b).getTime() - getTransactionDate(a).getTime())
            .slice(0, 5);
    }, [transactions]);


  const chartData = [
    { name: 'Deposits', total: totalDeposits, fill: 'hsl(var(--primary))' },
    { name: 'Loans', total: totalLoan, fill: 'hsl(var(--destructive))' },
  ];
  
  const hasMonthlyData = monthlyOverview.monthlyDeposits > 0 || monthlyOverview.monthlyLoan > 0 || monthlyOverview.monthlyInterest > 0 || monthlyOverview.monthlyPrincipal > 0;

  const getTxTypeClass = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return 'border-transparent bg-green-100 text-green-800';
        case 'loan': return 'border-transparent bg-red-100 text-red-800';
        case 'repayment': return 'border-transparent bg-blue-100 text-blue-800';
        case 'expense': return 'border-transparent bg-orange-100 text-orange-800';
        default: return '';
    }
  }

  const getTxTypeIcon = (type: Transaction['type']) => {
    switch(type) {
      case 'deposit': return <ArrowUp className="mr-1 h-3 w-3" />;
      case 'loan': return <ArrowDown className="mr-1 h-3 w-3" />;
      case 'repayment': return <HandCoins className="mr-1 h-3 w-3" />;
      case 'expense': return <ShieldX className="mr-1 h-3 w-3" />;
    }
  }

  const getInitials = (name: string) => {
    const names = name.split(' ');
    const initials = names.map(n => n[0]).join('');
    return initials.toUpperCase();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold font-headline">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Remaining Fund"
          value={loading ? '...' : `Rs. ${remainingFund.toLocaleString('en-IN')}`}
          icon={Banknote}
          loading={loading}
          description="Cash available in group"
        />
         <StatCard
          title="Total Deposits"
          value={loading ? '...' : `Rs. ${totalDeposits.toLocaleString('en-IN')}`}
          icon={PiggyBank}
          loading={loading}
          description="From active members"
        />
        <StatCard
          title="Total Loan Disbursed"
          value={loading ? '...' : `Rs. ${totalLoan.toLocaleString('en-IN')}`}
          icon={Landmark}
          loading={loading}
          description="To active members"
        />
         <StatCard
          title="Total Interest Earned"
          value={loading ? '...' : `Rs. ${totalInterest.toLocaleString('en-IN')}`}
          icon={LibraryBig}
          loading={loading}
          description="From loan repayments"
        />
         <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Members</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {loading ? (
                <Skeleton className="h-8 w-3/4" />
                ) : (
                    <div className="text-2xl font-bold font-headline">{totalMembers}</div>
                )}
                 <p className="text-xs text-muted-foreground">Total members in group</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Member Status</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {loading ? (
                <Skeleton className="h-8 w-3/4" />
                ) : (
                <div className="flex items-center text-lg font-bold font-headline gap-x-4">
                    <div className="flex items-center gap-1">
                        <UserCheck className="h-5 w-5 text-green-500"/>
                        <span>{activeMembersCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                         <UserX className="h-5 w-5 text-red-500"/>
                        <span>{inactiveMembersCount}</span>
                    </div>
                </div>
                )}
                 <p className="text-xs text-muted-foreground">Active vs. Inactive</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Loan Recovery</CardTitle>
                <Scale className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {loading ? (
                <Skeleton className="h-8 w-3/4" />
                ) : (
                <div className="text-2xl font-bold font-headline">Rs. {outstandingLoan.toLocaleString('en-IN')}</div>
                )}
                 <p className="text-xs text-muted-foreground">Outstanding loan balance</p>
            </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        
        <Card className="col-span-4 lg:col-span-7">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
                <CardTitle className="font-headline text-lg">Monthly Overview</CardTitle>
                <CalendarClock className="h-5 w-5 text-muted-foreground"/>
            </div>
            <p className="text-sm text-muted-foreground pt-1">
               {loading ? 'Loading...' : `Summary for ${format(monthlyOverview.displayMonth, 'MMMM yyyy')}`}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
                <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                </div>
            ) : (
                <div className="space-y-1">
                    <MonthlyOverviewStat 
                        title="Total Amount Deposits" 
                        value={`Rs. ${monthlyOverview.monthlyDeposits.toLocaleString('en-IN')}`}
                        loading={loading}
                    />
                    <MonthlyOverviewStat 
                        title="Amount Given as Loan" 
                        value={`Rs. ${monthlyOverview.monthlyLoan.toLocaleString('en-IN')}`}
                        loading={loading}
                    />
                    <MonthlyOverviewStat 
                        title="Interest Received" 
                        value={`Rs. ${monthlyOverview.monthlyInterest.toLocaleString('en-IN')}`}
                        loading={loading}
                    />
                    <MonthlyOverviewStat 
                        title="Principal Recovered" 
                        value={`Rs. ${monthlyOverview.monthlyPrincipal.toLocaleString('en-IN')}`}
                        loading={loading}
                    />
                </div>
            )}
          </CardContent>
        </Card>
      </div>
       
    </div>
  );
}

    