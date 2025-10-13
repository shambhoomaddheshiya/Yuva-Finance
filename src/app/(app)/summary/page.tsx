
'use client';

import { useState, useMemo } from 'react';
import { collection, query, Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { Member, Transaction } from '@/types';
import { format, getYear } from 'date-fns';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Banknote, Users, HandCoins, PiggyBank, Landmark } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

function SummaryDetailCard({ 
  title, 
  icon: Icon, 
  amount, 
  memberCount, 
  memberNames, 
  loading,
  amountLabel,
  membersLabel
}: { 
  title: string; 
  icon: React.ElementType; 
  amount: number; 
  memberCount: number; 
  memberNames: string[]; 
  loading: boolean;
  amountLabel: string;
  membersLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg font-headline">{title}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        ) : (
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {membersLabel}: <span className="font-semibold">{memberCount}</span>
              </p>
              {memberNames.length > 0 && (
                <Accordion type="single" collapsible className="w-full max-w-xs">
                  <AccordionItem value="item-1">
                    <AccordionTrigger className="text-sm py-2">View Members</AccordionTrigger>
                    <AccordionContent>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                        {memberNames.map((name, index) => <li key={index}>{name}</li>)}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </div>
            <div className="text-2xl font-bold font-headline text-right">
              ₹{amount.toLocaleString('en-IN')}
            </div>
          </div>
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
      return { 
        totalInterest: 0, 
        totalDeposit: 0, 
        depositMembers: [], 
        totalLoan: 0,
        loanTakers: [], 
        totalRepayment: 0,
        loanRepayers: [] 
      };
    }
    
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);

    const activeMemberIds = new Set(members.filter(m => m.status === 'active').map(m => m.id));
    const filteredTransactions = transactions.filter(tx => {
      const txDate = getTransactionDate(tx);
      return txDate.getFullYear() === year && txDate.getMonth() === month && activeMemberIds.has(tx.memberId);
    });
    
    const memberMap = new Map(members.map(m => [m.id, m.name]));

    const totalInterest = filteredTransactions
      .filter(t => t.type === 'repayment')
      .reduce((sum, t) => sum + (t.interest || 0), 0);
    
    const depositData = filteredTransactions.filter(t => t.type === 'deposit');
    const totalDeposit = depositData.reduce((sum, t) => sum + t.amount, 0);
    const depositMembers = [...new Set(depositData.map(t => memberMap.get(t.memberId) || 'Unknown'))];
    
    const loanData = filteredTransactions.filter(t => t.type === 'loan');
    const totalLoan = loanData.reduce((sum, t) => sum + t.amount, 0);
    const loanTakers = [...new Set(loanData.map(t => memberMap.get(t.memberId) || 'Unknown'))];

    const repaymentData = filteredTransactions.filter(t => t.type === 'repayment');
    const totalRepayment = repaymentData.reduce((sum, t) => sum + t.amount, 0);
    const loanRepayers = [...new Set(repaymentData.map(t => memberMap.get(t.memberId) || 'Unknown'))];

    return { 
      totalInterest, 
      totalDeposit, 
      depositMembers,
      totalLoan,
      loanTakers, 
      totalRepayment,
      loanRepayers 
    };

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
          <CardDescription>An overview of your group's financial activity for the selected month.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
           <SummaryDetailCard
              title="Interest Earned"
              icon={Banknote}
              amount={monthlySummary.totalInterest}
              memberCount={monthlySummary.loanRepayers.length}
              memberNames={monthlySummary.loanRepayers}
              loading={loading}
              amountLabel="Total Interest Collected"
              membersLabel="From Members"
           />
           <SummaryDetailCard
              title="Deposits Made"
              icon={PiggyBank}
              amount={monthlySummary.totalDeposit}
              memberCount={monthlySummary.depositMembers.length}
              memberNames={monthlySummary.depositMembers}
              loading={loading}
              amountLabel="Total Deposited"
              membersLabel="By Members"
           />
           <SummaryDetailCard
              title="Loans Disbursed"
              icon={Landmark}
              amount={monthlySummary.totalLoan}
              memberCount={monthlySummary.loanTakers.length}
              memberNames={monthlySummary.loanTakers}
              loading={loading}
              amountLabel="Total Loan Amount"
              membersLabel="To Members"
           />
           <SummaryDetailCard
              title="Loans Repaid"
              icon={HandCoins}
              amount={monthlySummary.totalRepayment}
              memberCount={monthlySummary.loanRepayers.length}
              memberNames={monthlySummary.loanRepayers}
              loading={loading}
              amountLabel="Total Repayment Amount"
              membersLabel="By Members"
           />
        </CardContent>
      </Card>
    </div>
  );
}


