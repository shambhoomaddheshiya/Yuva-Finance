'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2 } from 'lucide-react';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';

import { useDoc } from '@/firebase/firestore/use-doc';
import { useToast } from '@/hooks/use-toast';
import type { GroupSettings, Member } from '@/types';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

const settingsSchema = z.object({
  groupName: z.string().min(3, 'Group name must be at least 3 characters.'),
  monthlyContribution: z.coerce.number().positive('Must be a positive number.'),
  interestRate: z.coerce.number().min(0, 'Cannot be negative.').max(100, 'Cannot be over 100.'),
});

export default function SettingsPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const settingsRef = useMemoFirebase(() => user && firestore ? doc(firestore, `users/${user.uid}/groupSettings/settings`) : null, [user, firestore]);
  const { data: settings, isLoading: loading } = useDoc<GroupSettings>(settingsRef);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const isInitializing = loading || isUserLoading;

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      groupName: '',
      monthlyContribution: 0,
      interestRate: 0,
    }
  });

  useEffect(() => {
    // This effect handles two scenarios after initial loading is complete:
    // 1. Populating the form if settings exist.
    // 2. Creating default settings if they are missing for a logged-in user.
    
    // Wait until both user auth and data fetching are complete.
    if (isInitializing) {
      return;
    }

    if (user && firestore) {
      if (settings) {
        // Scenario 1: Settings exist, so populate the form.
        form.reset({
          groupName: settings.groupName,
          monthlyContribution: settings.monthlyContribution,
          interestRate: settings.interestRate,
        });
      } else if (settingsRef) {
        // Scenario 2: User is logged in but has no settings document. Create it.
        const createDefaultSettings = async () => {
          console.log(`Creating default settings for user ${user.uid}...`);
          
          try {
            const membersQuery = collection(firestore, `users/${user.uid}/members`);
            const membersSnapshot = await getDocs(membersQuery);
            const members = membersSnapshot.docs.map(doc => doc.data() as Member);
            const totalFundFromMembers = members.reduce((acc, member) => acc + member.currentBalance, 0);

            const newSettings: GroupSettings = {
              groupName: 'My Savings Group',
              monthlyContribution: 1000,
              interestRate: 2,
              totalMembers: members.length,
              totalFund: totalFundFromMembers,
              establishedDate: new Date().toISOString(),
            };

            await setDoc(settingsRef, newSettings);
            form.reset(newSettings); // Populate form with the newly created settings.
            toast({
              title: 'Settings Initialized',
              description: 'Default group settings have been created for you.',
            });
          } catch (e: any) {
            console.error("Failed to create default settings:", e);
            toast({
              variant: 'destructive',
              title: 'Error Initializing Settings',
              description: e.message || 'Could not initialize your settings. Please refresh the page.',
            });
          }
        };
        
        createDefaultSettings();
      }
    }
  }, [isInitializing, user, firestore, settings, settingsRef, form, toast]);


  async function onSubmit(values: z.infer<typeof settingsSchema>) {
    if (!user || !firestore || !settingsRef) return;
    setIsSubmitting(true);
    try {
      // Use the existing settings as a base to avoid overwriting fields
      // like totalFund, totalMembers, and establishedDate.
      const updatedSettings: Partial<GroupSettings> = {
        groupName: values.groupName,
        monthlyContribution: values.monthlyContribution,
        interestRate: values.interestRate,
      };
      
      await setDoc(settingsRef, updatedSettings, { merge: true });

      toast({
        title: 'Settings Saved!',
        description: 'Your group settings have been updated.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Save Failed',
        description: error.message || 'There was a problem saving the settings.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }
  
  const FormSkeleton = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold font-headline">Group Settings</h1>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="font-headline">Configuration</CardTitle>
              <CardDescription>Manage your group's core settings here.</CardDescription>
            </CardHeader>
            <CardContent>
              {isInitializing ? <FormSkeleton /> : (
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="groupName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Group Name</FormLabel>
                        <FormControl>
                          <Input placeholder="सहकारी बचत समूह" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="monthlyContribution"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Monthly Contribution (₹)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="2000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="interestRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Interest Rate (%)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t px-6 py-4">
              <Button type="submit" disabled={isSubmitting || isInitializing}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Settings
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}
