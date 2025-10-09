'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2 } from 'lucide-react';
import { collection, query, doc, getDoc, setDoc, getDocs } from 'firebase/firestore';

import { useDoc } from '@/firebase/firestore/use-doc';
import { useToast } from '@/hooks/use-toast';
import type { GroupSettings } from '@/types';
import { useUser, useFirestore, setDocumentNonBlocking, useMemoFirebase } from '@/firebase';

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
  const { user } = useUser();
  const firestore = useFirestore();

  const settingsRef = useMemoFirebase(() => user && firestore ? doc(firestore, `users/${user.uid}/groupSettings/settings`) : null, [user, firestore]);
  const { data: settings, isLoading: loading, error } = useDoc<GroupSettings>(settingsRef);

  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        groupName: settings.groupName,
        monthlyContribution: settings.monthlyContribution,
        interestRate: settings.interestRate,
      });
    } else if (!loading && !settings && user && firestore) {
      // If loading is finished, there are no settings, and user is available,
      // it means the document doesn't exist. Let's create it.
      const createDefaultSettings = async () => {
         if (!user) return; // Add guard to ensure user is available
        const membersRef = collection(firestore, `users/${user.uid}/members`);
        const membersSnap = await getDocs(membersRef);
        const memberCount = membersSnap.size;
        
        const defaultSettings: GroupSettings = {
          groupName: 'My Savings Group',
          monthlyContribution: 1000,
          interestRate: 2,
          totalMembers: memberCount,
          totalFund: 0,
          establishedDate: new Date().toISOString(),
        };
        if (settingsRef) {
          try {
            await setDoc(settingsRef, defaultSettings);
            form.reset(defaultSettings);
            toast({
              title: 'Settings Initialized',
              description: 'Default group settings have been created for you.',
            });
          } catch(e) {
            console.error("Failed to create default settings:", e);
             toast({
              variant: 'destructive',
              title: 'Failed to create settings',
              description: 'Could not initialize your settings. Please refresh.',
            });
          }
        }
      };
      createDefaultSettings();
    }
  }, [settings, loading, user, firestore, form, settingsRef, toast]);

  async function onSubmit(values: z.infer<typeof settingsSchema>) {
    if (!user || !firestore || !settings) return;
    setIsSubmitting(true);
    try {
      const updatedSettings: GroupSettings = {
        ...settings, // Carry over fields like totalMembers, totalFund etc.
        groupName: values.groupName,
        monthlyContribution: values.monthlyContribution,
        interestRate: values.interestRate,
      };

      setDocumentNonBlocking(settingsRef!, updatedSettings, { merge: true });

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
              {loading ? <FormSkeleton /> : (
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
              <Button type="submit" disabled={isSubmitting || loading}>
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
