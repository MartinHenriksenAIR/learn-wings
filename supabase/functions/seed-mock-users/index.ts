import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const mockUsers = [
  { email: 'maria.jensen@techcorp.dk', password: 'Test1234!', first_name: 'Maria', last_name: 'Jensen', department: 'Engineering' },
  { email: 'lars.nielsen@techcorp.dk', password: 'Test1234!', first_name: 'Lars', last_name: 'Nielsen', department: 'Sales' },
  { email: 'anna.petersen@nordic.dk', password: 'Test1234!', first_name: 'Anna', last_name: 'Petersen', department: 'Finance' },
  { email: 'mikkel.hansen@nordic.dk', password: 'Test1234!', first_name: 'Mikkel', last_name: 'Hansen', department: 'HR' },
  { email: 'sofie.andersen@green.dk', password: 'Test1234!', first_name: 'Sofie', last_name: 'Andersen', department: 'Operations' },
  { email: 'jonas.kristensen@green.dk', password: 'Test1234!', first_name: 'Jonas', last_name: 'Kristensen', department: 'IT' },
  { email: 'emma.larsen@health.dk', password: 'Test1234!', first_name: 'Emma', last_name: 'Larsen', department: 'Medical' },
  { email: 'oliver.moller@health.dk', password: 'Test1234!', first_name: 'Oliver', last_name: 'Møller', department: 'Administration' },
];

const orgAssignments = [
  { email: 'maria.jensen@techcorp.dk', org_id: '22222222-2222-2222-2222-222222222222', role: 'org_admin' },
  { email: 'lars.nielsen@techcorp.dk', org_id: '22222222-2222-2222-2222-222222222222', role: 'learner' },
  { email: 'anna.petersen@nordic.dk', org_id: '33333333-3333-3333-3333-333333333333', role: 'org_admin' },
  { email: 'mikkel.hansen@nordic.dk', org_id: '33333333-3333-3333-3333-333333333333', role: 'learner' },
  { email: 'sofie.andersen@green.dk', org_id: '44444444-4444-4444-4444-444444444444', role: 'learner' },
  { email: 'jonas.kristensen@green.dk', org_id: '44444444-4444-4444-4444-444444444444', role: 'learner' },
  { email: 'emma.larsen@health.dk', org_id: '55555555-5555-5555-5555-555555555555', role: 'org_admin' },
  { email: 'oliver.moller@health.dk', org_id: '55555555-5555-5555-5555-555555555555', role: 'learner' },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const results: { email: string; success: boolean; userId?: string; error?: string }[] = [];

    for (const user of mockUsers) {
      // Create auth user
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true, // Auto-confirm so they can log in
        user_metadata: {
          full_name: `${user.first_name} ${user.last_name}`,
        },
      });

      if (authError) {
        // User might already exist
        if (authError.message.includes('already been registered')) {
          const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
          const existing = existingUsers?.users?.find(u => u.email === user.email);
          if (existing) {
            results.push({ email: user.email, success: true, userId: existing.id, error: 'Already exists' });
            continue;
          }
        }
        results.push({ email: user.email, success: false, error: authError.message });
        continue;
      }

      const userId = authData.user?.id;
      if (!userId) {
        results.push({ email: user.email, success: false, error: 'No user ID returned' });
        continue;
      }

      // Update profile with additional info
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({
          first_name: user.first_name,
          last_name: user.last_name,
          department: user.department,
          full_name: `${user.first_name} ${user.last_name}`,
        })
        .eq('id', userId);

      if (profileError) {
        console.error(`Profile update error for ${user.email}:`, profileError);
      }

      // Add org membership
      const assignment = orgAssignments.find(a => a.email === user.email);
      if (assignment) {
        const { error: membershipError } = await supabaseAdmin
          .from('org_memberships')
          .insert({
            user_id: userId,
            org_id: assignment.org_id,
            role: assignment.role,
            status: 'active',
          });

        if (membershipError) {
          console.error(`Membership error for ${user.email}:`, membershipError);
        }
      }

      results.push({ email: user.email, success: true, userId });
    }

    console.log('Seed results:', results);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Seed error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
