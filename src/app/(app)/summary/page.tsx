
'use client';

import { useState, useMemo } from 'react';
import { collection, query, Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { Member, Transaction } from '@/types';
import { format, getYear } from 'date-fns';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Banknote, Users, HandCoins, PiggyBank } from 'lucide-react';

function SummaryStatCard({ title, value, icon: Icon, loading }: { title: string; value: string | number; icon: React.ElementType; loading: boolean; }) {
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
      </CardContent>
    </Card>
  );
}


export default function SummaryPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  
  const [selectedYear, setSelectedYear] = useState<string>(String(getYear(new Date())));
  const [selectedMonth, setSelectedMonth] = useState<string>(String(new Date().getMonth()));

  const transactionsRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`)) : null, [user, firestore]);
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);

  const { data: transactions, isLoading: txLoading } = useCollection<Transaction>(transactionsRef);
  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
  const loading = txLoading || membersLoading;

  const getTransactionDate = (tx: Transaction): Date => {
    if (tx.date instanceof Timestamp) {
      return tx.date.toDate();
    }
    return new Date(tx.date as string);
  };
  
  const monthlySummary = useMemo(() => {
    if (!transactions || !members) {
      return { totalInterest: 0, totalDeposit: 0, depositMembers: 0, loanTakers: 0, loanRepayers: 0 };
    }
    
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);

    const filteredTransactions = transactions.filter(tx => {
      const txDate = getTransactionDate(tx);
      return txDate.getFullYear() === year && txDate.getMonth() === month;
    });
    
    const activeMemberIds = new Set(members.filter(m => m.status === 'active').map(m => m.id));
    const activeFilteredTransactions = filteredTransactions.filter(t => activeMemberIds.has(t.memberId));

    const totalInterest = activeFilteredTransactions
      .filter(t => t.type === 'repayment')
      .reduce((sum, t) => sum + (t.interest || 0), 0);

    const depositData = activeFilteredTransactions.filter(t => t.type === 'deposit');
    const totalDeposit = depositData.reduce((sum, t) => sum + t.amount, 0);
    const depositMembers = new Set(depositData.map(t => t.memberId)).size;
    
    const loanTakers = new Set(activeFilteredTransactions.filter(t => t.type === 'loan').map(t => t.memberId)).size;
    const loanRepayers = new Set(activeFilteredTransactions.filter(t => t.type === 'repayment').map(t => t.memberId)).size;

    return { totalInterest, totalDeposit, depositMembers, loanTakers, loanRepayers };

  }, [transactions, members, selectedYear, selectedMonth]);

  const years = Array.from({ length: 10 }, (_, i) => getYear(new Date()) - i);
  const months = Array.from({ length: 12 }, (_, i) => ({
      value: String(i),
      label: format(new Date(0, i), 'MMMM'),
  }));


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <h1 className="text-3xl font-bold font-headline">Monthly Summary</h1>
        <div className="flex items-center gap-2">
            <Select onValueChange={setSelectedYear} value={selectedYear}>
                <SelectTrigger className="w-[120px]"><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                    {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
            </Select>
            <Select onValueChange={setSelectedMonth} value={selectedMonth}>
               <SelectTrigger className="w-[140px]"><SelectValue placeholder="Month" /></SelectTrigger>
                <SelectContent>
                    {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">
             Summary for {format(new Date(parseInt(selectedYear), parseInt(selectedMonth)), 'MMMM yyyy')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
           <SummaryStatCard
              title="Total Interest Earned"
              value={loading ? '...' : `₹${monthlySummary.totalInterest.toLocaleString('en-IN')}`}
              icon={Banknote}
              loading={loading}
           />
            <SummaryStatCard
              title="Total Deposits"
              value={loading ? '...' : `₹${monthlySummary.totalDeposit.toLocaleString('en-IN')}`}
              icon={PiggyBank}
              loading={loading}
           />
           <SummaryStatCard
              title="Members Deposited"
              value={loading ? '...' : monthlySummary.depositMembers}
              icon={Users}
              loading={loading}
           />
            <SummaryStatCard
              title="Members Took Loan"
              value={loading ? '...' : monthlySummary.loanTakers}
              icon={Users}
              loading={loading}
           />
            <SummaryStatCard
              title="Members Repaid Loan"
              value={loading ? '...' : monthlySummary.loanRepayers}
              icon={HandCoins}
              loading={loading}
           />
        </CardContent>
      </Card>

       <Card>
         <CardHeader>
           <CardTitle className="font-headline">
              Final Result
           </CardTitle>
         </CardHeader>
         <CardContent className="text-muted-foreground">
            {loading ? <Skeleton className="h-6 w-full" /> : (
              <p>
                In {format(new Date(parseInt(selectedYear), parseInt(selectedMonth)), 'MMMM yyyy')}, the group earned a total interest of <span className="font-bold text-primary">₹{monthlySummary.totalInterest.toLocaleString('en-IN')}</span>. 
                A total of <span className="font-bold text-primary">₹{monthlySummary.totalDeposit.toLocaleString('en-IN')}</span> was deposited by <span className="font-bold text-primary">{monthlySummary.depositMembers}</span> member(s). 
                During this period, <span className="font-bold text-primary">{monthlySummary.loanTakers}</span> member(s) took out new loans, and <span className="font-bold text-primary">{monthlySummary.loanRepayers}</span> member(s) made repayments.
              </p>
            )}
         </CardContent>
       </Card>
    </div>
  );
}
