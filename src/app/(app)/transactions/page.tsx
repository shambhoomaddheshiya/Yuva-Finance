'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, Loader2, Calendar as CalendarIcon, ArrowDown, ArrowUp } from 'lucide-react';
import { ref, set, push, update, get } from 'firebase/database';
import { db } from '@/lib/firebase';
import { format } from 'date-fns';

import { useRealtimeData } from '@/hooks/use-realtime';
import { useToast } from '@/hooks/use-toast';
import type { Member, Transaction } from '@/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';

const transactionSchema = z.object({
  memberId: z.string().nonempty('Please select a member.'),
  type: z.enum(['deposit', 'withdrawal'], {
    required_error: 'You need to select a transaction type.',
  }),
  amount: z.coerce.number().positive('Amount must be a positive number.'),
  date: z.date({ required_error: 'A date is required.' }),
  description: z.string().min(3, 'Description must be at least 3 characters.'),
});

function AddTransactionForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { data: members, loading: membersLoading } = useRealtimeData<Record<string, Member>>('members');
  const form = useForm<z.infer<typeof transactionSchema>>({
    resolver: zodResolver(transactionSchema),
    defaultValues: { date: new Date() },
  });

  async function onSubmit(values: z.infer<typeof transactionSchema>) {
    setIsLoading(true);
    try {
      const txRef = ref(db, 'transactions');
      const newTxRef = push(txRef);
      const newTxId = `TXN${newTxRef.key!.slice(-6).toUpperCase()}`;

      const memberRef = ref(db, `members/${values.memberId}`);
      const memberSnapshot = await get(memberRef);
      if (!memberSnapshot.exists()) throw new Error('Selected member not found.');
      
      const memberData: Member = memberSnapshot.val();
      const newBalance = values.type === 'deposit'
        ? memberData.currentBalance + values.amount
        : memberData.currentBalance - values.amount;

      if (values.type === 'withdrawal' && newBalance < 0) {
        throw new Error('Withdrawal amount exceeds member balance.');
      }

      const newTransaction: Transaction = {
        id: newTxId,
        ...values,
        date: format(values.date, 'yyyy-MM-dd'),
        balanceAfter: newBalance,
      };

      const updates: { [key: string]: any } = {};
      updates[`/transactions/${newTxId}`] = newTransaction;
      updates[`/members/${values.memberId}/currentBalance`] = newBalance;
      if (values.type === 'deposit') {
        updates[`/members/${values.memberId}/totalDeposited`] = memberData.totalDeposited + values.amount;
      } else {
        updates[`/members/${values.memberId}/totalWithdrawn`] = memberData.totalWithdrawn + values.amount;
      }
      
      await update(ref(db), updates);

      toast({
        title: 'Success!',
        description: 'New transaction has been recorded.',
      });
      form.reset({ date: new Date() });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description: error.message || 'There was a problem with your request.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="memberId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Member</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value} disabled={membersLoading}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a member" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {members && Object.values(members).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Transaction Type</FormLabel>
              <FormControl>
                <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                  <FormItem className="flex items-center space-x-3 space-y-0">
                    <FormControl><RadioGroupItem value="deposit" /></FormControl>
                    <FormLabel className="font-normal">Deposit</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-3 space-y-0">
                    <FormControl><RadioGroupItem value="withdrawal" /></FormControl>
                    <FormLabel className="font-normal">Withdrawal</FormLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount</FormLabel>
              <FormControl><Input type="number" placeholder="2000" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={'outline'}
                      className={cn(
                        'w-[240px] pl-3 text-left font-normal',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl><Textarea placeholder="मासिक जमा - ..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record Transaction
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export default function TransactionsPage() {
  const { data: transactions, loading: txLoading } = useRealtimeData<Record<string, Transaction>>('transactions');
  const { data: members, loading: membersLoading } = useRealtimeData<Record<string, Member>>('members');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const loading = txLoading || membersLoading;
  const txList = transactions ? Object.values(transactions).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-headline">Transactions</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Transaction
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-headline">Record New Transaction</DialogTitle>
              <DialogDescription>
                Select a member and enter the transaction details.
              </DialogDescription>
            </DialogHeader>
            <AddTransactionForm onOpenChange={setIsDialogOpen} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-headline">Transaction History</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(5)].map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-6 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : txList.length > 0 ? (
                txList.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-medium">{members?.[tx.memberId]?.name || 'Unknown'}</TableCell>
                    <TableCell>
                      <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${tx.type === 'deposit' ? 'border-transparent bg-green-100 text-green-800' : 'border-transparent bg-red-100 text-red-800'}`}>
                        {tx.type === 'deposit' ? <ArrowUp className="mr-1 h-3 w-3" /> : <ArrowDown className="mr-1 h-3 w-3" />}
                        {tx.type}
                      </div>
                    </TableCell>
                    <TableCell>{new Date(tx.date).toLocaleDateString()}</TableCell>
                    <TableCell>{tx.description}</TableCell>
                    <TableCell className={`text-right font-mono font-semibold ${tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.type === 'deposit' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN')}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    No transactions found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
