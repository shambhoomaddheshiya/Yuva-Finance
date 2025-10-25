
'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, Calendar as CalendarIcon, Banknote } from 'lucide-react';
import { collection, doc, query, writeBatch, Timestamp, where } from 'firebase/firestore';
import { format, getYear } from 'date-fns';

import { useCollection } from '@/firebase/firestore/use-collection';
import { useToast } from '@/hooks/use-toast';
import type { Member } from '@/types';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

const bulkDepositSchema = z.object({
  amount: z.coerce.number().positive('Amount must be a positive number.'),
  date: z.date({ required_error: 'A date is required.' }),
  description: z.string().optional(),
  memberIds: z.array(z.string()).min(1, 'Please select at least one member.'),
});

export default function BulkDepositPage() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useUser();
  const firestore = useFirestore();
  
  const activeMembersRef = useMemoFirebase(
    () => user && firestore ? query(collection(firestore, `users/${user.uid}/members`), where('status', '==', 'active')) : null,
    [user, firestore]
  );
  const { data: members, isLoading: membersLoading } = useCollection<Member>(activeMembersRef);

  const form = useForm<z.infer<typeof bulkDepositSchema>>({
    resolver: zodResolver(bulkDepositSchema),
    defaultValues: {
      amount: 0,
      date: new Date(),
      description: '',
      memberIds: [],
    },
  });

  const selectedMemberIds = form.watch('memberIds');

  async function onSubmit(values: z.infer<typeof bulkDepositSchema>) {
    if (!user || !firestore) return;

    setIsSubmitting(true);
    const { amount, date, description, memberIds } = values;
    const CHUNK_SIZE = 200; // Each member gets 1 transaction + 1 member update = 2 ops. Batch limit is 500.

    try {
        for (let i = 0; i < memberIds.length; i += CHUNK_SIZE) {
            const chunk = memberIds.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);

            chunk.forEach(memberId => {
                // 1. Create a new transaction document
                const newTxRef = doc(collection(firestore, `users/${user.uid}/transactions`));
                batch.set(newTxRef, {
                    memberId,
                    type: 'deposit',
                    amount,
                    date: Timestamp.fromDate(date),
                    description: description || `Monthly contribution`,
                });
            });

            await batch.commit();
        }

      toast({
        title: 'Success!',
        description: `Deposits recorded for ${memberIds.length} members.`,
      });
      form.reset({ amount: values.amount, date: values.date, description: values.description, memberIds: [] });
    } catch (error: any) {
      console.error("Bulk deposit failed:", error);
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description: error.message || 'There was a problem recording the deposits.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked && members) {
      form.setValue('memberIds', members.map(m => m.id));
    } else {
      form.setValue('memberIds', []);
    }
  };

  const isAllSelected = members && selectedMemberIds.length === members.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-headline">Bulk Deposit</h1>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Record Group Deposit</CardTitle>
              <CardDescription>
                Enter an amount and select members to record a deposit for multiple people at once. Only active members are shown.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                 <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Amount per Member (Rs)</FormLabel>
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
                        <FormLabel>Deposit Date</FormLabel>
                        <Popover>
                            <PopoverTrigger asChild>
                            <FormControl>
                                <Button
                                variant={'outline'}
                                className={cn(
                                    'pl-3 text-left font-normal',
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
                                captionLayout="dropdown-buttons"
                                fromYear={getYear(new Date()) - 10}
                                toYear={getYear(new Date())}
                                selected={field.value}
                                onSelect={field.onChange}
                                initialFocus
                            />
                            </PopoverContent>
                        </Popover>
                        <FormMessage />
                        </FormItem>
                    )}
                />
              </div>
               <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Description (Optional)</FormLabel>
                        <FormControl><Input placeholder="e.g., Monthly contribution for May" {...field} /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                
                <FormField
                    control={form.control}
                    name="memberIds"
                    render={() => (
                      <FormItem>
                        <div className="mb-4">
                          <FormLabel className="text-base">Select Members</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Choose which active members to include in this bulk deposit.
                          </p>
                        </div>
                        {membersLoading ? (
                             <div className="space-y-2">
                                <Skeleton className="h-8 w-full" />
                                <Skeleton className="h-8 w-full" />
                                <Skeleton className="h-8 w-full" />
                             </div>
                        ) : members && members.length > 0 ? (
                          <>
                            <div className="flex items-center space-x-2 pb-2 border-b">
                               <Checkbox
                                   id="select-all"
                                   checked={isAllSelected}
                                   onCheckedChange={handleSelectAll}
                               />
                               <label
                                   htmlFor="select-all"
                                   className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                               >
                                  Select All Members ({selectedMemberIds.length} / {members.length})
                               </label>
                           </div>
                           <ScrollArea className="h-60 w-full rounded-md border">
                            <div className="p-4 space-y-2">
                            {members.map((item) => (
                              <FormField
                                key={item.id}
                                control={form.control}
                                name="memberIds"
                                render={({ field }) => {
                                  return (
                                    <FormItem
                                      key={item.id}
                                      className="flex flex-row items-center space-x-3 space-y-0"
                                    >
                                      <FormControl>
                                        <Checkbox
                                          checked={field.value?.includes(item.id)}
                                          onCheckedChange={(checked) => {
                                            return checked
                                              ? field.onChange([...field.value, item.id])
                                              : field.onChange(
                                                  field.value?.filter(
                                                    (value) => value !== item.id
                                                  )
                                                )
                                          }}
                                        />
                                      </FormControl>
                                      <FormLabel className="font-normal w-full flex justify-between">
                                        <span>{item.name}</span>
                                        <span className="text-muted-foreground">{item.id}</span>
                                      </FormLabel>
                                    </FormItem>
                                  )
                                }}
                              />
                            ))}
                            </div>
                           </ScrollArea>
                          </>
                        ) : (
                            <div className="flex items-center justify-center h-40 w-full border-2 border-dashed rounded-md">
                                <p className="text-muted-foreground">No active members found.</p>
                            </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isSubmitting || membersLoading}>
                {isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
                ) : `Deposit for ${selectedMemberIds.length} members`}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}
